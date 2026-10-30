import { prisma } from "@/server/db/client";
import { requireWorkspace } from "@/server/auth/guard";
import { PageHeader } from "@/components/shared/kpi-card";
import { BrandsClient } from "@/components/brands/brands-client";

export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  const { workspaceId } = await requireWorkspace();
  const [brands, competitors] = await Promise.all([
    prisma.brand.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } }),
    prisma.competitor.findMany({ where: { workspaceId }, select: { id: true, brandId: true } }),
  ]);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="品牌管理"
        description="品牌档案决定匹配口径：名称、别名、产品名、官网域名与官方子域都会用于规则识别搜索结果中的品牌与页面归属。官网域名用于官网覆盖率，别名/产品名用于文本匹配。"
      />
      <BrandsClient
        brands={brands.map((b) => ({
          id: b.id,
          name: b.name,
          englishName: b.englishName,
          websiteUrl: b.websiteUrl,
          websiteDomain: b.websiteDomain,
          aliases: b.aliases,
          keywords: b.keywords,
          officialSubdomains: b.officialSubdomains,
          products: b.products,
          productAliases: b.productAliases,
          industry: b.industry,
          description: b.description,
          competitorCount: competitors.filter((c) => c.brandId === b.id).length,
          createdAt: b.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
