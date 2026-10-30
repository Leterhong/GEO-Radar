import { parseBody, handleApiError, writeAuditLog, withReadAuth, withWriteAuth } from "@/server/api/helpers";
import { credentialSaveSchema } from "@/lib/validation/schemas";
import {
  getMaskedCredentialConfig,
  saveCredential,
  clearCredential,
} from "@/server/services/provider-credential-service";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


/** 读取脱敏后的数据源配置（永远不返回完整 API Key）。 */
export async function GET() {
  return withReadAuth(async ({ workspaceId }) => {
    const config = await getMaskedCredentialConfig(workspaceId);
    return NextResponse.json({ ok: true, data: config });
  });
}

/** 保存 API Key（服务端加密存储；保存后需重新测试连接）。 */
export async function PUT(request: Request) {
  try {
    return await withWriteAuth(async ({ workspaceId, user }) => {
      const body = await parseBody(request, credentialSaveSchema);
      const { maskedKey } = await saveCredential(workspaceId, user.id, body.apiKey);
      const config = await getMaskedCredentialConfig(workspaceId);
      return NextResponse.json({ ok: true, data: { maskedKey, config } });
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/** 清除已保存的密钥。 */
export async function DELETE() {
  return withWriteAuth(async ({ workspaceId, user }) => {
    await clearCredential(workspaceId, user.id);
    const config = await getMaskedCredentialConfig(workspaceId);
    return NextResponse.json({ ok: true, data: config });
  });
}
