import { prisma } from "@/server/db/client";
import { withAuth, parseBody, apiFail, writeAuditLog } from "@/server/api/helpers";
import { evidenceReviewSchema } from "@/lib/validation/schemas";
import { z } from "zod";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";

type Params = { params: { evidenceId: string } };

const PAGE_TYPES = [
  "OFFICIAL_HOMEPAGE",
  "PRODUCT_PAGE",
  "DOCS_PAGE",
  "BLOG_NEWS",
  "THIRD_PARTY_MEDIA",
  "REVIEW_PAGE",
  "SOCIAL_MEDIA",
  "ECOMMERCE_PAGE",
  "COMMUNITY_FORUM",
  "OTHER",
  "UNKNOWN",
] as const;

export async function GET(_request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId }) => {
    const evidence = await prisma.evidence.findFirst({
      where: { id: params.evidenceId, workspaceId },
      include: {
        task: {
          select: {
            id: true,
            name: true,
            executionMode: true,
            provider: true,
            status: true,
            questionSetVersion: true,
            finishedAt: true,
          },
        },
        brand: { select: { id: true, name: true } },
        result: { select: { id: true, extra: true, position: true, itemId: true } },
        rawResponse: { select: { id: true, requestId: true, httpStatus: true, byteSize: true, truncated: true, createdAt: true } },
        reviewer: { select: { id: true, name: true } },
        reviews: {
          orderBy: { createdAt: "desc" },
          take: 30,
          include: { reviewer: { select: { name: true } } },
        },
      },
    });
    if (!evidence) return apiFail(404, "NOT_FOUND", "证据不存在或不属于当前工作空间。");
    // 原始响应体可能很大，不在详情接口返回全文；只返回可追溯元数据
    return { evidence };
  });
}

const patchSchema = evidenceReviewSchema.partial().extend({
  tags: z.array(z.string().trim().min(1).max(24)).max(10).optional(),
  relevance: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]).optional(),
  pageType: z.enum(PAGE_TYPES).optional(),
  brandId: z.string().nullable().optional(),
  reviewAction: z
    .enum(["CONFIRM_MATCH", "REJECT_MATCH", "MARK_UNCERTAIN", "SET_PAGE_TYPE", "SET_BRAND", "UPDATE_METADATA"])
    .optional(),
});

/**
 * 人工复核：
 * - 只修改分析层字段（mentionStatus / pageType / brandId / tags / relevance）；
 * - 原始搜索结果（SearchResult / RawSearchResponse）永不覆盖；
 * - 每次变更写入 EvidenceReview（操作人、时间、前后值）。
 */
export async function PATCH(request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId, user }) => {
    const existing = await prisma.evidence.findFirst({ where: { id: params.evidenceId, workspaceId } });
    if (!existing) return apiFail(404, "NOT_FOUND", "证据不存在或不属于当前工作空间。");
    const body = await parseBody(request, patchSchema);

    if (body.brandId !== undefined && body.brandId !== null) {
      const brand = await prisma.brand.findFirst({ where: { id: body.brandId, workspaceId } });
      if (!brand) return apiFail(400, "BRAND_NOT_FOUND", "目标品牌不存在或不属于当前工作空间。");
    }

    const action =
      body.reviewAction ??
      (body.pageType !== undefined
        ? "SET_PAGE_TYPE"
        : body.brandId !== undefined
          ? "SET_BRAND"
          : body.mentionStatus !== undefined
            ? "SET_MENTION_STATUS"
            : "UPDATE_METADATA");

    const nextMentionStatus =
      body.reviewAction === "CONFIRM_MATCH"
        ? "CONFIRMED_BRAND"
        : body.reviewAction === "REJECT_MATCH"
          ? "IRRELEVANT"
          : body.reviewAction === "MARK_UNCERTAIN"
            ? "AMBIGUOUS"
            : body.mentionStatus;

    const data: Prisma.EvidenceUpdateInput = {
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      ...(body.relevance !== undefined ? { relevance: body.relevance } : {}),
      ...(body.reviewNote !== undefined ? { reviewNote: body.reviewNote || null } : {}),
      ...(body.pageType !== undefined ? { pageType: body.pageType, pageTypeSource: "MANUAL" } : {}),
    };

    const touchesReview =
      nextMentionStatus !== undefined ||
      body.pageType !== undefined ||
      body.brandId !== undefined ||
      body.reviewNote !== undefined ||
      body.reviewAction !== undefined;

    if (nextMentionStatus !== undefined) {
      data.mentionStatus = nextMentionStatus;
      data.detectionMethod = "MANUAL";
    }
    if (body.reviewAction === "CONFIRM_MATCH" || body.reviewAction === "SET_BRAND") {
      data.detectionMethod = "MANUAL";
    }
    if (body.brandId !== undefined) {
      data.brand = body.brandId === null ? { disconnect: true } : { connect: { id: body.brandId } };
      if (body.brandId === null) {
        data.mentionStatus = "IRRELEVANT";
        data.detectionMethod = "MANUAL";
      } else if (nextMentionStatus === undefined) {
        data.mentionStatus = "CONFIRMED_BRAND";
        data.detectionMethod = "MANUAL";
      }
    }
    if (touchesReview) {
      data.reviewedAt = new Date();
      data.reviewer = { connect: { id: user.id } };
    }

    const updated = await prisma.$transaction(async (tx) => {
      const evidence = await tx.evidence.update({ where: { id: existing.id }, data });
      if (touchesReview) {
        await tx.evidenceReview.create({
          data: {
            workspaceId,
            evidenceId: existing.id,
            reviewerId: user.id,
            action,
            previous: {
              mentionStatus: existing.mentionStatus,
              detectionMethod: existing.detectionMethod,
              pageType: existing.pageType,
              pageTypeSource: existing.pageTypeSource,
              brandId: existing.brandId,
              tags: existing.tags,
              relevance: existing.relevance,
              reviewNote: existing.reviewNote,
            } as never,
            next: {
              mentionStatus: evidence.mentionStatus,
              detectionMethod: evidence.detectionMethod,
              pageType: evidence.pageType,
              pageTypeSource: evidence.pageTypeSource,
              brandId: evidence.brandId,
              tags: evidence.tags,
              relevance: evidence.relevance,
              reviewNote: evidence.reviewNote,
            } as never,
            note: body.reviewNote || null,
          },
        });
      }
      return evidence;
    });

    await writeAuditLog({
      workspaceId,
      userId: user.id,
      action: "EVIDENCE_REVIEWED",
      targetType: "Evidence",
      targetId: updated.id,
      metadata: { reviewAction: action, mentionStatus: updated.mentionStatus, pageType: updated.pageType },
    });
    return NextResponse.json({ ok: true, data: updated });
  });
}

/** 删除证据记录（不删除原始搜索任务与结果，原始数据仍可在任务详情中追溯）。 */
export async function DELETE(_request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId, user }) => {
    const existing = await prisma.evidence.findFirst({ where: { id: params.evidenceId, workspaceId } });
    if (!existing) return apiFail(404, "NOT_FOUND", "证据不存在或不属于当前工作空间。");
    await prisma.evidence.update({
      where: { id: existing.id },
      data: { mentionStatus: "IRRELEVANT", reviewNote: "（已从证据库移除）", reviewedAt: new Date(), reviewedById: user.id },
    });
    await writeAuditLog({
      workspaceId,
      userId: user.id,
      action: "EVIDENCE_ARCHIVED",
      targetType: "Evidence",
      targetId: existing.id,
    });
    return NextResponse.json({ ok: true, data: { archived: true } });
  });
}
