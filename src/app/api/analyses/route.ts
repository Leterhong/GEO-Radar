import { prisma } from "@/server/db/client";
import { withAuth, parseBody, apiFail } from "@/server/api/helpers";
import { createAnalysisTask, AnalysisError } from "@/server/services/analysis/analysis-service";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1, "请填写分析任务名称").max(100),
  brandId: z.string().min(1, "请选择品牌"),
  days: z.number().int().min(1).max(365).default(30),
  keywordFilter: z.string().trim().max(60).optional().or(z.literal("")),
  competitorIds: z.array(z.string()).max(10).optional(),
});

export async function GET(request: Request) {
  return withAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? undefined;
    const tasks = await prisma.analysisTask.findMany({
      where: { workspaceId, ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        brand: { select: { id: true, name: true } },
        _count: { select: { metrics: true, reports: true } },
      },
    });
    return {
      tasks: tasks.map((t) => ({
        id: t.id,
        name: t.name,
        brandName: t.brand?.name ?? null,
        status: t.status,
        days: t.days,
        keywordFilter: t.keywordFilter,
        sampleSize: t.sampleSize,
        answerCount: t.answerCount,
        scopeNote: t.scopeNote,
        errorMessage: t.errorMessage,
        metricCount: t._count.metrics,
        reportCount: t._count.reports,
        startedAt: t.startedAt?.toISOString() ?? null,
        finishedAt: t.finishedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
      })),
    };
  });
}

/** 创建分析任务：只读取已保存数据，不发起任何外部搜索或模型调用。 */
export async function POST(request: Request) {
  return withAuth(async ({ workspaceId, user }) => {
    const body = await parseBody(request, createSchema);
    try {
      const task = await createAnalysisTask(workspaceId, user.id, {
        name: body.name,
        brandId: body.brandId,
        days: body.days ?? 30,
        keywordFilter: body.keywordFilter || null,
        competitorIds: body.competitorIds,
      });
      return NextResponse.json({ ok: true, data: task });
    } catch (error) {
      if (error instanceof AnalysisError) return apiFail(400, error.code, error.message);
      throw error;
    }
  });
}
