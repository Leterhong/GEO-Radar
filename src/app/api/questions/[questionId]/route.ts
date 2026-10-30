import { prisma } from "@/server/db/client";
import { parseBody, apiFail, withReadAuth, withWriteAuth } from "@/server/api/helpers";
import { questionSchema } from "@/lib/validation/schemas";
import { publishQuestionSetVersion } from "@/server/services/question-set-service";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";

type Params = { params: { questionId: string } };

/** 问题详情：包括所属问题集与版本信息。 */
export async function GET(_request: Request, { params }: Params) {
  return withReadAuth(async ({ workspaceId }) => {
    const question = await prisma.question.findFirst({
      where: { id: params.questionId, workspaceId },
      include: { questionSet: { select: { id: true, name: true, currentVersion: true, archivedAt: true } } },
    });
    if (!question) return apiFail(404, "NOT_FOUND", "问题不存在或不属于当前工作空间。");
    return { question };
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return withWriteAuth(async ({ workspaceId, user }) => {
    const existing = await prisma.question.findFirst({ where: { id: params.questionId, workspaceId } });
    if (!existing) return apiFail(404, "NOT_FOUND", "问题不存在或不属于当前工作空间。");
    const body = await parseBody(request, questionSchema.partial().omit({ questionSetId: true }));
    const question = await prisma.question.update({
      where: { id: existing.id },
      data: {
        text: body.text,
        category: body.category,
        intent: body.intent,
        region: body.region,
        language: body.language,
        priority: body.priority,
        enabled: body.enabled,
      },
    });
    const version = await publishQuestionSetVersion(workspaceId, existing.questionSetId, user.id, {
      changedQuestionIds: [existing.id],
      note: "编辑问题",
    });
    return NextResponse.json({ ok: true, data: { question, version } });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return withWriteAuth(async ({ workspaceId, user }) => {
    const existing = await prisma.question.findFirst({ where: { id: params.questionId, workspaceId } });
    if (!existing) return apiFail(404, "NOT_FOUND", "问题不存在或不属于当前工作空间。");
    await prisma.question.delete({ where: { id: existing.id } });
    const version = await publishQuestionSetVersion(workspaceId, existing.questionSetId, user.id, {
      note: "删除问题",
    });
    return NextResponse.json({ ok: true, data: { deleted: true, version } });
  });
}
