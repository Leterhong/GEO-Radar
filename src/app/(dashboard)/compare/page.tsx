import { prisma } from "@/server/db/client";
import { requireWorkspace } from "@/server/auth/guard";
import { PageHeader } from "@/components/shared/kpi-card";
import { ComparisonClient } from "@/components/comparison/comparison-client";

export const dynamic = "force-dynamic";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: { baseline?: string; retest?: string };
}) {
  const { workspaceId } = await requireWorkspace();
  const tasks = await prisma.searchTask.findMany({
    where: {
      workspaceId,
      status: { in: ["COMPLETED", "PARTIAL_FAILED", "FAILED", "CANCELLED"] },
    },
    orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
    include: { brand: { select: { name: true } } },
  });

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        title="两轮采集比较"
        description="基于真实历史快照比较两轮结果：核心指标、问题级变化、页面增减、数据质量与观测波动。失败与空结果单独列出，不当作品牌未出现。"
      />
      <ComparisonClient
        tasks={tasks.map((task) => ({
          id: task.id,
          name: task.name,
          brandId: task.brandId,
          brandName: task.brand?.name ?? null,
          status: task.status,
          executionMode: task.executionMode,
          questionSetVersion: task.questionSetVersion,
          finishedAt: task.finishedAt?.toISOString() ?? null,
          successItems: task.successItems,
          failedItems: task.failedItems,
        }))}
        initialBaselineId={searchParams.baseline}
        initialRetestId={searchParams.retest}
      />
    </div>
  );
}
