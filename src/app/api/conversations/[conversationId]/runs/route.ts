import { withAuth, parseBody, apiFail, handleApiError } from "@/server/api/helpers";
import { startRun, ConversationError } from "@/server/services/conversation/orchestrator";
import { NextResponse } from "next/server";
import { z } from "zod";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


type Params = { params: { conversationId: string } };

const schema = z.object({
  mode: z.enum(["SEARCH_ANSWER", "SEARCH_EVIDENCE", "GEO_ANALYSIS"]),
  content: z.string().trim().min(1, "消息内容不能为空").max(500),
  brandId: z.string().optional().or(z.literal("")),
  searchOnly: z.boolean().optional(),
});

/** 发起执行：创建 Run 并异步执行；页面加载/模式切换不会调用本接口。 */
export async function POST(request: Request, { params }: Params) {
  try {
    return await withAuth(async ({ workspaceId, user }) => {
      const body = await parseBody(request, schema);
      try {
        const result = await startRun(params.conversationId, workspaceId, user.id, {
          mode: body.mode,
          content: body.content,
          brandId: body.brandId || null,
          searchOnly: body.searchOnly,
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
