import { withAuth, apiFail } from "@/server/api/helpers";
import { createRetestTask, RetestError } from "@/server/services/retest-service";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const retestSchema = z.object({
  name: z.string().trim().max(100).optional(),
  description: z.string().trim().max(500).optional(),
  questionSetVersionId: z.string().optional(),
});

type Params = { params: { taskId: string } };

/** 创建复测任务（QUEUED）。不会自动执行，也不会复用上一轮结果。 */
export async function POST(request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId, user }) => {
    const body = (await request.json().catch(() => ({}))) ?? {};
    const parsed = retestSchema.safeParse(body);
    if (!parsed.success) return apiFail(400, "VALIDATION_ERROR", "请求参数校验失败", parsed.error.flatten());
    try {
      const task = await createRetestTask(workspaceId, user.id, params.taskId, parsed.data);
      return NextResponse.json({ ok: true, data: { task, estimatedRequests: task.totalItems } });
    } catch (error) {
      if (error instanceof RetestError) return apiFail(400, error.code, error.message);
      throw error;
    }
  });
}
