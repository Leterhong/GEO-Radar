import { prisma } from "@/server/db/client";
import { withAuth } from "@/server/api/helpers";
import { computeOverviewMetrics, computeBrandTrend, computeSourceDomains, computeCompetitorMetrics } from "@/server/services/metrics";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


/** 大屏数据：需要登录；只读已保存数据，不会触发任何搜索。 */
export async function GET(request: Request) {
  return withAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    const brandId = url.searchParams.get("brandId") ?? undefined;
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? "30")));
    const [metrics, trend, sources, competitors, latestTask] = await Promise.all([
      computeOverviewMetrics(workspaceId, brandId || undefined, days),
      brandId ? computeBrandTrend(workspaceId, brandId, days) : Promise.resolve([]),
      computeSourceDomains(workspaceId, brandId || undefined, days, 10),
      brandId ? computeCompetitorMetrics(workspaceId, brandId, days) : Promise.resolve([]),
      prisma.searchTask.findFirst({
        where: { workspaceId, executionMode: "REAL" },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, status: true, finishedAt: true },
      }),
    ]);
    const taskStats = await prisma.searchTask.groupBy({
      by: ["status"],
      where: { workspaceId, executionMode: "REAL" },
      _count: { status: true },
    });
    const latestEvidence = await prisma.evidence.findMany({
      where: { workspaceId, isMock: false },
      orderBy: { collectedAt: "desc" },
      take: 6,
      select: { id: true, title: true, domain: true, collectedAt: true, mentionStatus: true },
    });
    return {
      metrics,
      trend,
      sources,
      competitors,
      latestTask,
      taskStats: taskStats.map((t) => ({ status: t.status, count: t._count.status })),
      latestEvidence,
      generatedAt: new Date().toISOString(),
      note: "大屏只展示已保存的历史数据；刷新页面不会触发任何真实搜索。",
    };
  });
}
