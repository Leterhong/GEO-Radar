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
    const body = (await request.json().catch(() => ({}))) as {
      filters?: Record<string, string | string[] | number>;
      limit?: number;
    };
    const f = body.filters ?? {};
    const str = (key: string) => (typeof f[key] === "string" ? (f[key] as string) : undefined);
    const ids = Array.isArray(f.evidenceIds) ? f.evidenceIds.map(String) : undefined;
    const limit = Math.min(5000, Math.max(1, Number(body.limit ?? f.limit ?? 5000)));
    const since = str("since");
    const until = str("until");
    const where: Prisma.EvidenceWhereInput = {
      workspaceId,
      ...(str("brandId") ? { brandId: str("brandId") } : {}),
      ...(str("taskId") ? { taskId: str("taskId") } : {}),
      ...(str("domain") ? { domain: str("domain") } : {}),
      ...(str("mentionStatus") ? { mentionStatus: str("mentionStatus") as never } : {}),
      ...(str("pageType") ? { pageType: str("pageType") as never } : {}),
      ...(str("search") ? { OR: [
        { title: { contains: str("search"), mode: "insensitive" } },
        { snippet: { contains: str("search"), mode: "insensitive" } },
      ] } : {}),
      ...(ids && ids.length > 0 ? { id: { in: ids } } : {}),
      ...(since || until
        ? { collectedAt: { ...(since ? { gte: new Date(since) } : {}), ...(until ? { lte: new Date(until) } : {}) } }
        : {}),
    };
    const evidence = await prisma.evidence.findMany({
      where,
      orderBy: { collectedAt: "desc" },
      take: limit,
      include: {
        brand: { select: { name: true } },
        task: { select: { name: true } },
        result: { select: { extra: true } },
      },
    });
    const questionIds = Array.from(new Set(evidence.map((e) => e.questionId).filter((id): id is string => Boolean(id))));
    const questions = questionIds.length
      ? await prisma.question.findMany({ where: { id: { in: questionIds } }, select: { id: true, text: true } })
      : [];
    const questionText = new Map(questions.map((q) => [q.id, q.text]));
    const { serializeCsv } = await import("@/lib/csv");
    const csv = serializeCsv(
      [
        "evidence_id",
        "query",
        "brand",
        "title",
        "url",
        "snippet",
        "site_name",
        "score",
        "request_id",
        "collected_at",
        "source_type",
        "page_type",
        "mention_status",
        "is_mock",
        "task_id",
      ],
      evidence.map((e) => {
        const extra = (e.result?.extra ?? {}) as Record<string, unknown>;
        return [
          e.id,
          e.questionId ? (questionText.get(e.questionId) ?? "") : "",
          e.brand?.name ?? "",
          e.title,
          e.url,
          e.snippet ?? "",
          typeof extra.siteName === "string" ? extra.siteName : "",
          typeof extra.score === "number" ? String(extra.score) : typeof extra.score === "string" ? extra.score : "",
          e.requestId ?? "",
          e.collectedAt.toISOString(),
          e.sourceRole,
          e.pageType,
          e.mentionStatus,
          e.isMock ? "true" : "false",
          e.taskId,
        ];
      })
    );
    await writeAuditLog({
      workspaceId,
      userId: user.id,
      action: "EVIDENCE_EXPORTED",
      metadata: { count: evidence.length, filters: Object.keys(f) },
    });
    return new NextResponse(`\uFEFF${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="georadar-evidence-${Date.now()}.csv"`,
      },
    });
  });
}
