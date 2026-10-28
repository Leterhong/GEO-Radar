import { prisma } from "@/server/db/client";
import { withAuth, apiFail } from "@/server/api/helpers";
import {
  computeOverviewMetrics,
  computeBrandTrend,
  computeSourceDomains,
  computeCompetitorMetrics,
} from "@/server/services/metrics";

export const dynamic = "force-dynamic";

/** 品牌可见度页数据：必须指定品牌；仅统计真实数据。 */
export async function GET(request: Request) {
  return withAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    const brandId = url.searchParams.get("brandId");
    if (!brandId) return apiFail(400, "BRAND_REQUIRED", "请先选择要分析的品牌。");
    const brand = await prisma.brand.findFirst({ where: { id: brandId, workspaceId } });
    if (!brand) return apiFail(404, "NOT_FOUND", "品牌不存在或不属于当前工作空间。");
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? "30")));
    const [metrics, trend, sources, competitors] = await Promise.all([
      computeOverviewMetrics(workspaceId, brandId, days),
      computeBrandTrend(workspaceId, brandId, days),
      computeSourceDomains(workspaceId, brandId, days, 15),
      computeCompetitorMetrics(workspaceId, brandId, days),
    ]);
    // 各问题表现（按问题分类聚合，口径与总览一致）
    const questionPerformance = await prisma.searchTaskItem.findMany({
      where: { workspaceId, status: "SUCCESS", task: { executionMode: "REAL", brandId } },
      select: {
        questionId: true,
        questionText: true,
        question: { select: { category: true } },
        _count: { select: { results: true } },
        results: { select: { evidence: { select: { mentionStatus: true } } }, take: 50 },
      },
      orderBy: { executedAt: "desc" },
      take: 200,
    });
    const categoryAgg = new Map<string, { total: number; appeared: number }>();
    for (const item of questionPerformance) {
      const category = item.question?.category ?? "未分类";
      const entry = categoryAgg.get(category) ?? { total: 0, appeared: 0 };
      entry.total += 1;
      if (item.results.some((r) => r.evidence.some((e) => e.mentionStatus === "CONFIRMED_BRAND"))) {
        entry.appeared += 1;
      }
      categoryAgg.set(category, entry);
    }
    const categories = Array.from(categoryAgg.entries()).map(([name, v]) => ({
      name,
      total: v.total,
      appeared: v.appeared,
      rate: v.total > 0 ? v.appeared / v.total : null,
    }));
    return {
      brand: { id: brand.id, name: brand.name, websiteDomain: brand.websiteDomain },
      metrics,
      trend,
      sources,
      competitors,
      categories,
      brandMetadata: {
        aliases: brand.aliases,
        keywords: brand.keywords,
      },
    };
  });
}
