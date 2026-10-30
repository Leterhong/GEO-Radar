import { prisma } from "@/server/db/client";
import { apiFail, withReadAuth } from "@/server/api/helpers";
import { computeCompetitorMetrics, computeOverviewMetrics } from "@/server/services/metrics";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


export async function GET(request: Request) {
  return withReadAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    const brandId = url.searchParams.get("brandId");
    if (!brandId) return apiFail(400, "BRAND_REQUIRED", "请先选择品牌。");
    const brand = await prisma.brand.findFirst({ where: { id: brandId, workspaceId } });
    if (!brand) return apiFail(404, "NOT_FOUND", "品牌不存在或不属于当前工作空间。");
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? "30")));
    const [metrics, brandMetrics, competitors] = await Promise.all([
      computeCompetitorMetrics(workspaceId, brandId, days),
      computeOverviewMetrics(workspaceId, brandId, days),
      prisma.competitor.findMany({ where: { workspaceId, brandId }, orderBy: { createdAt: "asc" } }),
    ]);
    return {
      brand: { id: brand.id, name: brand.name, appearanceRate: brandMetrics.brandAppearance.value, validSamples: brandMetrics.brandAppearance.validSamples },
      competitors: competitors.map((c) => {
        const m = metrics.find((row) => row.competitorId === c.id);
        return {
          id: c.id,
          name: c.name,
          websiteDomain: c.websiteDomain,
          description: c.description,
          appearanceRate: m?.appearanceRate ?? null,
          validSamples: m?.validSamples ?? 0,
        };
      }),
      methodology:
        "品牌与竞品使用同一口径：以有效已完成问题（真实模式、状态成功）为分母，每个问题只计一次；未检测到提及不代表该品牌在全网不存在。",
    };
  });
}
