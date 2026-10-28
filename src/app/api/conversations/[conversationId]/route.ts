import { prisma } from "@/server/db/client";
import { withAuth, parseBody, apiFail } from "@/server/api/helpers";
import { NextResponse } from "next/server";
import { z } from "zod";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


type Params = { params: { conversationId: string } };

const patchSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  currentMode: z.enum(["SEARCH_ANSWER", "SEARCH_EVIDENCE", "GEO_ANALYSIS"]).optional(),
  isFavorite: z.boolean().optional(),
});

export async function GET(_request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId }) => {
    const conversation = await prisma.conversation.findFirst({
      where: { id: params.conversationId, workspaceId },
    });
    if (!conversation) return apiFail(404, "NOT_FOUND", "会话不存在或不属于当前工作空间。");
    const messages = await prisma.conversationMessage.findMany({
      where: { conversationId: conversation.id, role: { in: ["USER", "ASSISTANT"] }, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    const runs = await prisma.conversationRun.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        userMessageId: true,
        assistantMessageId: true,
        mode: true,
        status: true,
        stage: true,
        searchTaskId: true,
        searchError: true,
        modelError: true,
        modelProvider: true,
        modelName: true,
        errorCode: true,
        promptTokens: true,
        completionTokens: true,
        startedAt: true,
        finishedAt: true,
      },
    });
    return {
      conversation: {
        id: conversation.id,
        title: conversation.title,
        currentMode: conversation.currentMode,
        isFavorite: conversation.isFavorite,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
      },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        mode: m.mode,
        status: m.status,
        runId: m.runId,
        createdAt: m.createdAt.toISOString(),
      })),
      runs: runs.map((r) => ({
        ...r,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
      })),
    };
  });
}

/** 重命名 / 切换当前模式（只影响后续新消息；不触发任何执行）。 */
export async function PATCH(request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId }) => {
    const conversation = await prisma.conversation.findFirst({
      where: { id: params.conversationId, workspaceId },
    });
    if (!conversation) return apiFail(404, "NOT_FOUND", "会话不存在或不属于当前工作空间。");
    const body = await parseBody(request, patchSchema);
    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.currentMode !== undefined ? { currentMode: body.currentMode } : {}),
        ...(body.isFavorite !== undefined ? { isFavorite: body.isFavorite } : {}),
      },
    });
    return NextResponse.json({
      ok: true,
      data: { id: updated.id, title: updated.title, currentMode: updated.currentMode, isFavorite: updated.isFavorite },
    });
  });
}

/** 删除会话：级联删除消息/运行/引用；已保存的搜索任务与证据不受影响（SearchTask.runs SetNull）。 */
export async function DELETE(_request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId }) => {
    const conversation = await prisma.conversation.findFirst({
      where: { id: params.conversationId, workspaceId },
    });
    if (!conversation) return apiFail(404, "NOT_FOUND", "会话不存在或不属于当前工作空间。");
    await prisma.conversation.delete({ where: { id: conversation.id } });
    return NextResponse.json({ ok: true, data: {} });
  });
}
