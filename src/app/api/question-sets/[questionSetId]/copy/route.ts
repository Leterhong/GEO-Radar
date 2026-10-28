import { withAuth, apiFail, writeAuditLog } from "@/server/api/helpers";
import { copyQuestionSet, QuestionSetError } from "@/server/services/question-set-service";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const copySchema = z.object({ name: z.string().trim().max(100).optional() });
type Params = { params: { questionSetId: string } };

/** 复制问题集：创建全新的问题与版本 1，不复制历史任务/证据。 */
export async function POST(request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId, user }) => {
    const body = (await request.json().catch(() => ({}))) as unknown;
    const parsed = copySchema.safeParse(body ?? {});
    if (!parsed.success) return apiFail(400, "VALIDATION_ERROR", "请求参数校验失败");
    try {
      const result = await copyQuestionSet(workspaceId, user.id, params.questionSetId, parsed.data.name);
      await writeAuditLog({
        workspaceId,
        userId: user.id,
        action: "QUESTION_SET_COPIED",
        targetType: "QuestionSet",
        targetId: result.questionSetId,
        metadata: { sourceQuestionSetId: params.questionSetId },
      });
      return NextResponse.json({ ok: true, data: result });
    } catch (error) {
      if (error instanceof QuestionSetError) return apiFail(400, error.code, error.message);
      throw error;
    }
  });
}
