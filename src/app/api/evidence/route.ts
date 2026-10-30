import { prisma } from "@/server/db/client";
import { writeAuditLog, withReadAuth, withWriteAuth } from "@/server/api/helpers";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


/** 证据列表：关键词/品牌/域名/时间/状态/任务筛选，仅限当前工作空间。 */
export async function GET(request: Request) {
  return withReadAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    const search = url.searchParams.get("search") ?? undefined;
    const brandId = url.searchParams.get("brandId") ?? undefined;
    const domain = url.searchParams.get("domain") ?? undefined;
    const taskId = url.searchParams.get("taskId") ?? undefined;
    const mentionStatus = url.searchParams.get("mentionStatus") ?? undefined;
    const pageType = url.searchParams.get("pageType") ?? undefined;
    const since = url.searchParams.get("since") ?? undefined;
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? "20")));
    const where: Prisma.EvidenceWhereInput = {
      workspaceId,
      ...(search ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { snippet: { contains: search, mode: "insensitive" } }] } : {}),
      ...(brandId ? { brandId } : {}),
      ...(domain ? { domain } : {}),
      ...(taskId ? { taskId } : {}),
      ...(mentionStatus ? { mentionStatus: mentionStatus as never } : {}),
      ...(pageType ? { pageType: pageType as never } : {}),
      ...(since ? { collectedAt: { gte: new Date(since) } } : {}),
    };
    const [total, evidence] = await Promise.all([
      prisma.evidence.count({ where }),
      prisma.evidence.findMany({
        where,
        orderBy: { collectedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { task: { select: { id: true, name: true, executionMode: true } } },
      }),
    ]);
    return { evidence, total, page, pageSize };
  });
}

/** 导出证据 CSV（仅当前工作空间、仅限有权限的数据）。 */
export async function POST(request: Request) {
  return withWriteAuth(async ({ workspaceId, user }) => {
    const body = (await request.json().catch(() => ({}))) as { filters?: Record<string, string> };
    const f = body.filters ?? {};
    const where: Prisma.EvidenceWhereInput = {
      workspaceId,
      ...(f.brandId ? { brandId: f.brandId } : {}),
      ...(f.taskId ? { taskId: f.taskId } : {}),
      ...(f.domain ? { domain: f.domain } : {}),
      ...(f.mentionStatus ? { mentionStatus: f.mentionStatus as never } : {}),
      ...(f.pageType ? { pageType: f.pageType as never } : {}),
    };
    const evidence = await prisma.evidence.findMany({
      where,
      orderBy: { collectedAt: "desc" },
      take: 5000,
    });
    const { serializeCsv } = await import("@/lib/csv");
    const csv = serializeCsv(
      [
        "title",
        "url",
        "normalizedUrl",
        "domain",
        "pageType",
        "sourceRole",
        "brandMatchBasis",
        "snippet",
        "publishedAt",
        "collectedAt",
        "mentionStatus",
        "isMock",
        "taskId",
      ],
      evidence.map((e) => [
        e.title,
        e.url,
        e.normalizedUrl ?? "",
        e.domain ?? "",
        e.pageType,
        e.sourceRole,
        e.brandMatchBasis.join("|"),
        e.snippet ?? "",
        e.publishedAt ?? "",
        e.collectedAt.toISOString(),
        e.mentionStatus,
        e.isMock ? "true" : "false",
        e.taskId,
      ])
    );
    await writeAuditLog({
      workspaceId,
      userId: user.id,
      action: "EVIDENCE_EXPORTED",
      metadata: { count: evidence.length },
    });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="georadar-evidence-${Date.now()}.csv"`,
      },
    });
  });
}
