import { handleApiError, rateLimit, withWriteAuth } from "@/server/api/helpers";
import { testModelConnection } from "@/server/services/model-credential-service";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


/** 模型连接测试：发起一次最小真实请求（少量 Token 消耗），必须由用户主动点击。 */
export async function POST() {
  try {
    return await withWriteAuth(async ({ workspaceId, user }) => {
      rateLimit(`model-test:${workspaceId}`, 6, 10 * 60 * 1000);
      const result = await testModelConnection(workspaceId, user.id);
      return NextResponse.json({
        ok: true,
        data: {
          ...result,
          notice: "连接测试会向模型服务发起一次真实的对话请求，产生少量 Token 消耗。",
        },
      });
    });
  } catch (error) {
    return handleApiError(error);
  }
}
