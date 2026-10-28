import { prisma } from "@/server/db/client";
import { withAuth, apiFail, writeAuditLog } from "@/server/api/helpers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Params = { params: { conversationId: string; messageId: string } };

/** 删除消息（软删除）：保留执行记录与证据关联，不物理删除历史答案。 */
export async function DELETE(_request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId, user }) => {
    const message = await prisma.conversationMessage.findFirst({
      where: {
        id: params.messageId,
        conversationId: params.conversationId,
        conversation: { workspaceId },
      },
    });
    if (!message) return apiFail(404, "NOT_FOUND", "消息不存在或不属于当前会话。");
    if (message.deletedAt) return NextResponse.json({ ok: true, data: { deleted: true, alreadyDeleted: true } });
    await prisma.conversationMessage.update({
      where: { id: message.id },
      data: { deletedAt: new Date() },
    });
    await writeAuditLog({
      workspaceId,
      userId: user.id,
      action: "CONVERSATION_MESSAGE_DELETED",
      targetType: "ConversationMessage",
      targetId: message.id,
      metadata: { conversationId: params.conversationId, role: message.role },
    });
    return NextResponse.json({ ok: true, data: { deleted: true } });
  });
}
