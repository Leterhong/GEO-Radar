import { withAuth, parseBody, handleApiError } from "@/server/api/helpers";
import {
  getMaskedModelConfig,
  saveModelConfig,
  clearModelConfig,
} from "@/server/services/model-credential-service";
import { NextResponse } from "next/server";
import { z } from "zod";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


const saveSchema = z.object({
  displayName: z.string().trim().max(60).optional(),
  baseUrl: z.string().trim().min(1).max(300),
  modelName: z.string().trim().min(1).max(120),
  apiKey: z.string().trim().min(8).max(300),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(16).max(32000).optional(),
});

/** 大模型配置（脱敏读取）：与元宝密钥分开存储，永不返回完整 Key。 */
export async function GET() {
  return withAuth(async ({ workspaceId }) => {
    const config = await getMaskedModelConfig(workspaceId);
    return NextResponse.json({ ok: true, data: config });
  });
}

export async function PUT(request: Request) {
  try {
    return await withAuth(async ({ workspaceId, user }) => {
      const body = await parseBody(request, saveSchema);
      const { maskedKey } = await saveModelConfig(workspaceId, user.id, body);
      const config = await getMaskedModelConfig(workspaceId);
      return NextResponse.json({ ok: true, data: { maskedKey, config } });
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE() {
  return withAuth(async ({ workspaceId, user }) => {
    await clearModelConfig(workspaceId, user.id);
    const config = await getMaskedModelConfig(workspaceId);
    return NextResponse.json({ ok: true, data: config });
  });
}
