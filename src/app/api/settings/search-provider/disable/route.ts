import { parseBody, handleApiError, withWriteAuth } from "@/server/api/helpers";
import { setCredentialDisabled, getMaskedCredentialConfig } from "@/server/services/provider-credential-service";
import { NextResponse } from "next/server";
import { z } from "zod";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


const schema = z.object({ disabled: z.boolean() });

/** 禁用 / 重新启用数据源。 */
export async function POST(request: Request) {
  try {
    return await withWriteAuth(async ({ workspaceId, user }) => {
      const body = await parseBody(request, schema);
      await setCredentialDisabled(workspaceId, user.id, body.disabled);
      const config = await getMaskedCredentialConfig(workspaceId);
      return NextResponse.json({ ok: true, data: config });
    });
  } catch (error) {
    return handleApiError(error);
  }
}
