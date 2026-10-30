import { prisma } from "@/server/db/client";
import { apiFail, handleApiError, withWriteAuth } from "@/server/api/helpers";
import { startRun, ConversationError } from "@/server/services/conversation/orchestrator";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


type Params = { params: { conversationId: string; runId: string } };

/** 重新执行：沿用原 Run 的问题与模式（不改历史消息），产生新的用户消息与 Run。 */
export async function POST(_request: Request, { params }: Params) {
  try {
    return await withWriteAuth(async ({ workspaceId, user }) => {
      const run = await prisma.conversationRun.findFirst({
        where: { id: params.runId, conversationId: params.conversationId, conversation: { workspaceId } },
        include: { userMessage: true },
      });
      if (!run) return apiFail(404, "NOT_FOUND", "执行记录不存在或不属于当前会话。");
      try {
        const result = await startRun(params.conversationId, workspaceId, user.id, {
          mode: run.mode,
          content: run.userMessage.content,
          brandId: run.brandId,
        });
        return NextResponse.json({ ok: true, data: result });
      } catch (error) {
        if (error instanceof ConversationError) {
          return apiFail(400, error.code, error.message);
        }
        throw error;
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}
