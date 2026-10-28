import { withAuth, apiFail } from "@/server/api/helpers";
import { compareTaskRounds, ComparisonError } from "@/server/services/comparison-service";

export const dynamic = "force-dynamic";

/** 两轮采集比较（真实快照）。?baseline=&retest=&includeSeries=true */
export async function GET(request: Request) {
  return withAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    const baselineTaskId = url.searchParams.get("baseline");
    const retestTaskId = url.searchParams.get("retest");
    if (!baselineTaskId || !retestTaskId) {
      return apiFail(400, "PARAMS_REQUIRED", "请提供 baseline 与 retest 两个任务 ID。");
    }
    try {
      const comparison = await compareTaskRounds(workspaceId, baselineTaskId, retestTaskId, {
        includeSeries: url.searchParams.get("includeSeries") !== "false",
      });
      return { comparison };
    } catch (error) {
      if (error instanceof ComparisonError) return apiFail(400, error.code, error.message);
      if (error instanceof Error && error.message.includes("任务不存在")) {
        return apiFail(404, "TASK_NOT_FOUND", error.message);
      }
      throw error;
    }
  });
}
