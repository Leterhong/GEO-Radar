import { headers } from "next/headers";
import { withAuth, apiFail } from "@/server/api/helpers";
import { ApiTokenError, revokeApiToken } from "@/server/auth/api-token";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: { tokenId: string } }) {
  if (headers().get("authorization")) {
    return apiFail(403, "SESSION_REQUIRED", "API Token 管理需要浏览器登录会话。");
  }
  return withAuth(async ({ workspaceId }) => {
    try {
      await revokeApiToken(workspaceId, params.tokenId);
      return { revoked: true };
    } catch (error) {
      if (error instanceof ApiTokenError) return apiFail(404, error.code, error.message);
      throw error;
    }
  });
}
