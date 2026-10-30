import { prisma } from "@/server/db/client";
import { parseBody, apiFail, withReadAuth, withWriteAuth } from "@/server/api/helpers";
import { questionSetSchema } from "@/lib/validation/schemas";
import { publishQuestionSetVersion, archiveQuestionSet, QuestionSetError } from "@/server/services/question-set-service";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";

type Params = { params: { questionSetId: string } };

export async function GET(_request: Request, { params }: Params) {
  return withReadAuth(async ({ workspaceId }) => {
    const set = await prisma.questionSet.findFirst({
      where: { id: params.questionSetId, workspaceId },
      include: {
        questions: { orderBy: [{ priority: "desc" }, { createdAt: "asc" }] },
        versions: { orderBy: { version: "desc" }, take: 20 },
      },
    });
    if (!set) return apiFail(404, "NOT_FOUND", "问题集不存在或不属于当前工作空间。");
    return { questionSet: set };
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return withWriteAuth(async ({ workspaceId, user }) => {
    const existing = await prisma.questionSet.findFirst({ where: { id: params.questionSetId, workspaceId } });
    if (!existing) return apiFail(404, "NOT_FOUND", "问题集不存在或不属于当前工作空间。");
    const body = await parseBody(request, questionSetSchema.partial());
    try {
      const set = await prisma.questionSet.update({
        where: { id: existing.id },
        data: {
          name: body.name,
          description: body.description !== undefined ? body.description || undefined : undefined,
        },
      });
      const version = await publishQuestionSetVersion(workspaceId, set.id, user.id, {
        note: "问题集名称/说明变更",
      });
      return NextResponse.json({ ok: true, data: { questionSet: set, version } });
    } catch (error) {
      if (error instanceof QuestionSetError) return apiFail(400, error.code, error.message);
      throw error;
    }
  });
}

/** 归档（不物理删除）：历史任务、版本快照与证据保持可追溯；引用它的启用排期会自动暂停。 */
export async function DELETE(_request: Request, { params }: Params) {
  return withWriteAuth(async ({ workspaceId }) => {
    try {
      await archiveQuestionSet(workspaceId, params.questionSetId);
      return NextResponse.json({ ok: true, data: { archived: true } });
    } catch (error) {
      if (error instanceof QuestionSetError) return apiFail(400, error.code, error.message);
      throw error;
    }
  });
}
