import { apiFail, withWriteAuth } from "@/server/api/helpers";
import { runScheduleNow, ScheduleError } from "@/server/services/schedule-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Params = { params: { scheduleId: string } };

/** 用户主动「立即执行」：创建真实任务并在后台执行；仍受成本确认与并发限制约束。 */
export async function POST(_request: Request, { params }: Params) {
  return withWriteAuth(async ({ workspaceId, user }) => {
    try {
      const result = await runScheduleNow(workspaceId, user.id, params.scheduleId);
      return NextResponse.json({ ok: true, data: result });
    } catch (error) {
      if (error instanceof ScheduleError) return apiFail(400, error.code, error.message);
      throw error;
    }
  });
}
