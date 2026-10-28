import { requireWorkspace } from "@/server/auth/guard";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/shared/kpi-card";
import { OptimizationClient } from "@/components/optimization/optimization-client";

export const dynamic = "force-dynamic";

export default async function OptimizationPage() {
  const { workspaceId } = await requireWorkspace();
  const [tasks, brands] = await Promise.all([
    prisma.optimizationTask.findMany({
      where: { workspaceId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: { brand: { select: { name: true } } },
    }),
    prisma.brand.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
  ]);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="GEO 优化任务"
        description="由规则引擎基于可追溯证据生成，也可手动创建。每条建议都标注生成依据；完成优化后可复测对比。"
      />
      <OptimizationClient
        brands={brands}
        tasks={tasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
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
    </div>
  );
}
