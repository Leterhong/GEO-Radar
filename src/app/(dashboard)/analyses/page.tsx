import { prisma } from "@/server/db/client";
import { requireWorkspace } from "@/server/auth/guard";
import { PageHeader } from "@/components/shared/kpi-card";
import { AnalysesClient } from "@/components/analyses/analyses-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "GEO 分析" };

export default async function AnalysesPage() {
  const { workspaceId } = await requireWorkspace();
  const [brands, competitors] = await Promise.all([
    prisma.brand.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    prisma.competitor.findMany({ where: { workspaceId }, select: { id: true, name: true, brandId: true } }),
  ]);
  const competitorsByBrand: Record<string, Array<{ id: string; name: string }>> = {};
  for (const competitor of competitors) {
    competitorsByBrand[competitor.brandId] = [
      ...(competitorsByBrand[competitor.brandId] ?? []),
      { id: competitor.id, name: competitor.name },
    ];
  }
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="GEO 分析"
        description="基于已保存的搜索问答回答与实验室任务，由确定性代码计算品牌提及率、引用率、竞品对比与趋势。"
      />
      <AnalysesClient brands={brands} competitorsByBrand={competitorsByBrand} />
    </div>
  );
}
