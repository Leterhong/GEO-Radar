import { prisma } from "@/server/db/client";
import { withAuth } from "@/server/api/helpers";
import { computeOverviewMetrics, computeBrandTrend, computeSourceDomains } from "@/server/services/metrics";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


/** 总览数据：所有指标由后端统一口径计算，含样本量与口径说明。 */
export async function GET(request: Request) {
  return withAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    const brandId = url.searchParams.get("brandId") ?? undefined;
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? "30")));
    const [metrics, trend, sources, brands] = await Promise.all([
      computeOverviewMetrics(workspaceId, brandId || undefined, days),
      brandId ? computeBrandTrend(workspaceId, brandId, days) : Promise.resolve([]),
      computeSourceDomains(workspaceId, brandId || undefined, days, 10),
      prisma.brand.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    ]);
    const recentTasks = await prisma.searchTask.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { brand: { select: { name: true } }, creator: { select: { name: true } } },
    });
    const recentEvidence = await prisma.evidence.findMany({
      where: { workspaceId, isMock: false },
      orderBy: { collectedAt: "desc" },
      take: 5,
      select: { id: true, title: true, url: true, domain: true, collectedAt: true, mentionStatus: true },
    });
    return { metrics, trend, sources, brands, recentTasks, recentEvidence };
  });
}
