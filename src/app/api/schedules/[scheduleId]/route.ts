import { withAuth, parseBody, apiFail } from "@/server/api/helpers";
import { updateSchedule, cancelSchedule, ScheduleError } from "@/server/services/schedule-service";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Params = { params: { scheduleId: string } };

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["ACTIVE", "PAUSED", "CANCELLED"]).optional(),
  frequency: z.enum(["DAILY", "WEEKLY"]).optional(),
  timezone: z.string().trim().max(60).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  minute: z.number().int().min(0).max(59).optional(),
  weekday: z.number().int().min(1).max(7).nullable().optional(),
  confirmedCost: z.boolean().optional(),
  params: z
    .object({
      maxResults: z.number().int().optional(),
      mode: z.number().int().optional(),
      industry: z.enum(["gov", "news", "acad", "finance"]).optional(),
      freshness: z.string().max(30).optional(),
      site: z.string().max(500).optional(),
      deeplinks: z.boolean().optional(),
    })
    .optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId, user }) => {
    const body = await parseBody(request, updateSchema);
    try {
      const schedule = await updateSchedule(workspaceId, user.id, params.scheduleId, body);
      return NextResponse.json({ ok: true, data: schedule });
    } catch (error) {
      if (error instanceof ScheduleError) return apiFail(400, error.code, error.message);
      throw error;
    }
  });
}

/** 取消排期（保留执行历史；不删除已产生的任务）。 */
export async function DELETE(_request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId, user }) => {
    try {
      const schedule = await cancelSchedule(workspaceId, user.id, params.scheduleId);
      return NextResponse.json({ ok: true, data: schedule });
    } catch (error) {
      if (error instanceof ScheduleError) return apiFail(400, error.code, error.message);
      throw error;
    }
  });
}
