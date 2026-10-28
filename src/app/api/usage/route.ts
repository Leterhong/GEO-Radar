import { withAuth } from "@/server/api/helpers";
import { getUsageSummary } from "@/server/services/usage-service";

export const dynamic = "force-dynamic";

/** 用量统计：只展示真实记录；费用未知时不估算。 */
export async function GET(request: Request) {
  return withAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? "30")));
    return getUsageSummary(workspaceId, days);
  });
}
