import { withAuth, handleApiError, rateLimit } from "@/server/api/helpers";
import { testCredentialConnection } from "@/server/services/provider-credential-service";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


/**
 * 连接测试：使用已保存密钥发起一次真实最小搜索请求（Query-only）。
 * 会产生真实计费调用；必须由用户主动点击触发。
 */
export async function POST() {
  try {
    return await withAuth(async ({ workspaceId, user }) => {
      rateLimit(`conn-test:${workspaceId}`, 6, 10 * 60 * 1000);
      const result = await testCredentialConnection(workspaceId, user.id);
      return NextResponse.json({
        ok: true,
        data: { ...result, notice: "连接测试会向元宝搜索发起一次真实的搜索请求，可能产生实际调用费用。" },
      });
    });
  } catch (error) {
    return handleApiError(error);
  }
}
