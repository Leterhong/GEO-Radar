import { requireWorkspace } from "@/server/auth/guard";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/shared/kpi-card";
import { OptimizationClient } from "@/components/optimization/optimization-client";
import { OptimizationEventsPanel } from "@/components/optimization/optimization-events-panel";

export const dynamic = "force-dynamic";

export default async function OptimizationPage() {
  const { workspaceId } = await requireWorkspace();
  const [tasks, brands, events, taskOptions] = await Promise.all([
    prisma.optimizationTask.findMany({
      where: { workspaceId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: { brand: { select: { name: true } } },
    }),
    prisma.brand.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    prisma.optimizationEvent.findMany({
      where: { workspaceId },
      orderBy: { occurredAt: "desc" },
      take: 50,
      include: { brand: { select: { name: true } } },
    }),
    prisma.searchTask.findMany({
      where: { workspaceId, executionMode: "REAL", status: { in: ["COMPLETED", "PARTIAL_FAILED"] } },
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: { id: true, name: true, finishedAt: true },
    }),
  ]);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="GEO 优化中心"
        description="从真实证据识别机会、记录页面修改，并用前后两轮搜索观察变化。变化只代表本次可比样本中的观察结果，不证明因果关系。"
      />
      <OptimizationClient
        brands={brands}
        tasks={tasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          pageUrl: t.pageUrl,
          type: t.type,
          priority: t.priority,
          status: t.status,
          brandName: t.brand?.name ?? null,
          evidenceCount: t.evidenceIds.length,
          questionCount: t.questionRefs.length,
          generatedBy: t.generatedBy,
          createdAt: t.createdAt.toISOString(),
          dueDate: t.dueDate?.toISOString() ?? null,
        }))}
      />
      <OptimizationEventsPanel
        brands={brands}
        events={events.map((event) => ({
          id: event.id,
          name: event.name,
          brandName: event.brand?.name ?? null,
          occurredAt: event.occurredAt.toISOString(),
          contentChanged: event.contentChanged,
          pageUrls: event.pageUrls,
          note: event.note,
          baselineTaskId: event.baselineTaskId,
          retestTaskId: event.retestTaskId,
        }))}
        tasks={taskOptions.map((task) => ({
          id: task.id,
          name: task.name,
          finishedAt: task.finishedAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
