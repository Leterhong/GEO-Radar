import { withAuth, apiFail, handleApiError } from "@/server/api/helpers";
import { cancelRun, ConversationError } from "@/server/services/conversation/orchestrator";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


type Params = { params: { conversationId: string; runId: string } };

/** 停止执行：置取消标记，执行器在阶段间与模型调用中响应；不虚报底层已中断。 */
export async function POST(_request: Request, { params }: Params) {
  try {
    return await withAuth(async ({ workspaceId, user }) => {
      try {
        await cancelRun(params.runId, workspaceId, user.id);
        return NextResponse.json({ ok: true, data: { accepted: true } });
      } catch (error) {
        if (error instanceof ConversationError) {
          return apiFail(409, error.code, error.message);
        }
        throw error;
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}
