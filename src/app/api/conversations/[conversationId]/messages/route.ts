import { prisma } from "@/server/db/client";
import { apiFail, withReadAuth } from "@/server/api/helpers";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


type Params = { params: { conversationId: string } };

export async function GET(_request: Request, { params }: Params) {
  return withReadAuth(async ({ workspaceId }) => {
    const conversation = await prisma.conversation.findFirst({
      where: { id: params.conversationId, workspaceId },
    });
    if (!conversation) return apiFail(404, "NOT_FOUND", "会话不存在或不属于当前工作空间。");
    const messages = await prisma.conversationMessage.findMany({
      where: { conversationId: conversation.id, role: { in: ["USER", "ASSISTANT"] } },
      orderBy: { createdAt: "asc" },
    });
    return {
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        mode: m.mode,
        status: m.status,
        runId: m.runId,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  });
}
