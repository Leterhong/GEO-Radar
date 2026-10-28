import { withAuth, parseBody, apiFail } from "@/server/api/helpers";
import { createSchedule, listSchedules, ScheduleError } from "@/server/services/schedule-service";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1, "请填写排期名称").max(100),
  brandId: z.string().optional(),
  questionSetId: z.string().min(1, "请选择问题集"),
  questionSetVersionId: z.string().optional(),
  frequency: z.enum(["DAILY", "WEEKLY"]),
  timezone: z.string().trim().max(60).optional(),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  weekday: z.number().int().min(1).max(7).nullable().optional(),
  executionMode: z.enum(["REAL", "MOCK"]),
  confirmedCost: z.boolean(),
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

export async function GET() {
  return withAuth(async ({ workspaceId }) => {
    const data = await listSchedules(workspaceId);
    return {
      ...data,
      config: {
        maxConcurrent: env.scheduleMaxConcurrent,
        maxQuestions: env.scheduleMaxQuestions,
        maxActivePerWorkspace: env.scheduleMaxActivePerWorkspace,
        cronConfigured: Boolean(env.cronSecret),
        tickIntervalMs: env.scheduleTickIntervalMs,
      },
    };
  });
}

export async function POST(request: Request) {
  return withAuth(async ({ workspaceId, user }) => {
    const body = await parseBody(request, createSchema);
    try {
      const result = await createSchedule(workspaceId, user.id, {
        name: body.name,
        brandId: body.brandId || undefined,
        questionSetId: body.questionSetId,
        questionSetVersionId: body.questionSetVersionId,
        frequency: body.frequency,
        timezone: body.timezone,
        hour: body.hour,
        minute: body.minute,
        weekday: body.weekday ?? null,
        executionMode: body.executionMode,
        confirmedCost: body.confirmedCost,
        params: body.params,
      });
      return NextResponse.json({ ok: true, data: result });
    } catch (error) {
      if (error instanceof ScheduleError) return apiFail(400, error.code, error.message);
      throw error;
    }
  });
}
