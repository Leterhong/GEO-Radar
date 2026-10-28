import { requireWorkspace } from "@/server/auth/guard";
import { prisma } from "@/server/db/client";
import { PageHeader, EmptyState } from "@/components/shared/kpi-card";
import { ReportsClient } from "@/components/reports/reports-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "分析报告" };

export default async function ReportsPage({ searchParams }: { searchParams: { taskId?: string } }) {
  const { workspaceId } = await requireWorkspace();
  const [reports, analyses, tasks] = await Promise.all([
    prisma.report.findMany({
      where: { workspaceId },
      orderBy: { generatedAt: "desc" },
      take: 100,
      include: { brand: { select: { name: true } } },
    }),
    prisma.analysisTask.findMany({
      where: { workspaceId, status: { in: ["COMPLETED", "PARTIALLY_COMPLETED"] } },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { brand: { select: { name: true } }, _count: { select: { metrics: true } } },
    }),
    prisma.searchTask.findMany({
      where: {
        workspaceId,
        executionMode: "REAL",
        status: { in: ["COMPLETED", "PARTIAL_FAILED"] },
      },
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
      take: 50,
      include: {
        brand: { select: { name: true } },
        questionSet: { select: { name: true } },
        _count: { select: { evidence: true } },
      },
    }),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="分析报告"
        description="以真实搜索证据为核心的报告：问题矩阵、指标口径、代表性证据、历史变化与数据限制全部落库为快照；支持 Markdown / HTML / 多种 CSV 导出。"
      />
      {reports.length === 0 && analyses.length === 0 && tasks.length === 0 ? (
        <EmptyState
          title="还没有可生成报告的数据"
          description="先执行一轮真实搜索任务，或完成一个 GEO 分析任务，再一键生成报告。"
          action={
            <a
              href="/search-lab"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary-strong"
            >
              前往搜索实验室
            </a>
          }
        />
      ) : (
        <ReportsClient
          reports={reports.map((r) => ({
            id: r.id,
            title: r.title,
            kind: r.kind,
            brandName: r.brand?.name ?? null,
            searchTaskId: r.searchTaskId,
            version: r.version,
            generatedAt: r.generatedAt.toISOString(),
            windowFrom: r.dataWindowFrom?.toISOString() ?? null,
            windowTo: r.dataWindowTo?.toISOString() ?? null,
          }))}
          candidates={analyses.map((a) => ({
            id: a.id,
            name: a.name,
            brandName: a.brand?.name ?? null,
            metricCount: a._count.metrics,
            status: a.status,
          }))}
          tasks={tasks.map((task) => ({
            id: task.id,
            name: task.name,
            brandName: task.brand?.name ?? null,
            questionSetName: task.questionSet?.name ?? null,
            questionSetVersion: task.questionSetVersion,
            baselineTaskId: task.baselineTaskId,
            totalItems: task.totalItems,
            successItems: task.successItems,
            failedItems: task.failedItems,
            emptyItems: task.emptyItems,
            evidenceCount: task._count.evidence,
            finishedAt: task.finishedAt?.toISOString() ?? null,
          }))}
          initialTaskId={searchParams.taskId}
        />
      )}
    </div>
  );
}
