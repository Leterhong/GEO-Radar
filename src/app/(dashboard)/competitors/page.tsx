import { requireWorkspace } from "@/server/auth/guard";
import { prisma } from "@/server/db/client";
import { computeOverviewMetrics, computeCompetitorMetrics } from "@/server/services/metrics";
import { PageHeader, EmptyState } from "@/components/shared/kpi-card";
import { BrandFilter } from "@/components/shared/brand-filter";
import { CompetitorManager } from "@/components/competitors/competitor-manager";
import { formatPercent } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CompetitorsPage({
  searchParams,
}: {
  searchParams: { brandId?: string; days?: string };
}) {
  const { workspaceId } = await requireWorkspace();
  const brands = await prisma.brand.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  const brandId = searchParams.brandId ?? brands[0]?.id;
  const days = Math.min(365, Math.max(1, Number(searchParams.days ?? "30")));

  if (!brandId) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="竞品分析" />
        <EmptyState title="尚未创建品牌" description="先创建品牌档案，再添加竞品进行对比。" />
      </div>
    );
  }

  const [competitors, metrics, brandMetrics] = await Promise.all([
    prisma.competitor.findMany({ where: { workspaceId, brandId }, orderBy: { createdAt: "asc" } }),
    computeCompetitorMetrics(workspaceId, brandId, days),
    computeOverviewMetrics(workspaceId, brandId, days),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="竞品分析"
        description="品牌与竞品使用同一统计口径对比；样本量不同时会明确标注，避免不公平比较。"
        actions={<BrandFilter brands={brands} days={days} basePath="/competitors" currentBrandId={brandId} />}
      />

      {brands.length === 0 ? (
        <EmptyState title="尚未创建品牌" description="请先创建品牌档案。" />
      ) : (
        <CompetitorManager
          brandId={brandId}
          competitors={competitors.map((c) => ({
            id: c.id,
            name: c.name,
            aliases: c.aliases,
            websiteUrl: c.websiteUrl,
            websiteDomain: c.websiteDomain,
            industry: c.industry,
            products: c.products,
            enabled: c.enabled,
            description: c.description,
            note: c.note,
            appearanceRate: metrics.find((m) => m.competitorId === c.id)?.appearanceRate ?? null,
            validSamples: metrics.find((m) => m.competitorId === c.id)?.validSamples ?? 0,
          }))}
          brand={{
            name: brands.find((b) => b.id === brandId)?.name ?? "",
            appearanceRate: brandMetrics.brandAppearance.value,
            validSamples: brandMetrics.brandAppearance.validSamples,
          }}
        />
      )}
      <p className="mt-6 text-[12px] text-tertiary">
        口径说明：{formatPercent(brandMetrics.brandAppearance.value)} 为本品牌出现率（有效样本{" "}
        {brandMetrics.brandAppearance.validSamples} 个问题）。「未检测到」只说明本次样本中没有出现，不能断言竞品在互联网中不存在。
        <Button asChild variant="link" className="h-auto px-1 text-xs">
          <Link href="/visibility">查看完整口径 →</Link>
        </Button>
      </p>
    </div>
  );
}
