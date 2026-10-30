import { prisma } from "@/server/db/client";
import { apiFail, withReadAuth, withWriteAuth } from "@/server/api/helpers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Params = { params: { analysisId: string } };

export async function GET(_request: Request, { params }: Params) {
  return withReadAuth(async ({ workspaceId }) => {
    const task = await prisma.analysisTask.findFirst({
      where: { id: params.analysisId, workspaceId },
      include: { brand: { select: { id: true, name: true, websiteDomain: true } }, reports: { select: { id: true, title: true, generatedAt: true } } },
    });
    if (!task) return apiFail(404, "NOT_FOUND", "分析任务不存在或不属于当前工作空间。");
    const metrics = await prisma.analysisMetric.findMany({
      where: { taskId: task.id },
      orderBy: { createdAt: "asc" },
    });
    return {
      task: {
        id: task.id,
        name: task.name,
        status: task.status,
        brand: task.brand,
        days: task.days,
        keywordFilter: task.keywordFilter,
        competitorIds: task.competitorIds,
        scopeNote: task.scopeNote,
        sampleSize: task.sampleSize,
        answerCount: task.answerCount,
        errorMessage: task.errorMessage,
        startedAt: task.startedAt?.toISOString() ?? null,
        finishedAt: task.finishedAt?.toISOString() ?? null,
        createdAt: task.createdAt.toISOString(),
      },
      metrics: metrics.map((m) => ({
        id: m.id,
        key: m.key,
        label: m.label,
        value: m.value,
        numerator: m.numerator,
        denominator: m.denominator,
        formulaVersion: m.formulaVersion,
        insufficient: m.insufficient,
        notes: m.notes,
        breakdown: m.breakdown,
      })),
      reports: task.reports.map((r) => ({ id: r.id, title: r.title, generatedAt: r.generatedAt.toISOString() })),
    };
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return withWriteAuth(async ({ workspaceId }) => {
    const task = await prisma.analysisTask.findFirst({ where: { id: params.analysisId, workspaceId } });
    if (!task) return apiFail(404, "NOT_FOUND", "分析任务不存在或不属于当前工作空间。");
    // 报告通过 onDelete: SetNull 保留快照，不随任务删除而丢失
    await prisma.analysisTask.delete({ where: { id: task.id } });
    return NextResponse.json({ ok: true, data: { deleted: true, reportsKept: true } });
  });
}
