import { withAuth, apiFail } from "@/server/api/helpers";
import { cancelAnalysisTask, retryAnalysisTask, AnalysisError } from "@/server/services/analysis/analysis-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Params = { params: { analysisId: string } };

/** action: cancel | retry */
export async function POST(request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId, user }) => {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    try {
      if (action === "cancel") {
        await cancelAnalysisTask(params.analysisId, workspaceId, user.id);
        return NextResponse.json({ ok: true, data: { cancelled: true } });
      }
      if (action === "retry") {
        await retryAnalysisTask(params.analysisId, workspaceId, user.id);
        return NextResponse.json({ ok: true, data: { retried: true } });
      }
      return apiFail(400, "INVALID_ACTION", "action 必须为 cancel 或 retry");
    } catch (error) {
      if (error instanceof AnalysisError) return apiFail(/NOT_FOUND/.test(error.code) ? 404 : 409, error.code, error.message);
      throw error;
    }
  });
}
