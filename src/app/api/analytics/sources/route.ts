import { withAuth } from "@/server/api/helpers";
import { computeSourceDomains } from "@/server/services/metrics";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


export async function GET(request: Request) {
  return withAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    const brandId = url.searchParams.get("brandId") ?? undefined;
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? "30")));
    const limit = Math.min(50, Math.max(5, Number(url.searchParams.get("limit") ?? "15")));
    const sources = await computeSourceDomains(workspaceId, brandId || undefined, days, limit);
    return {
      sources,
      note: "来源数量多不一定代表权威性高，也不代表这些来源一定会影响其他搜索系统的回答。",
    };
  });
}
