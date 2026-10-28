import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, apiFail, parseBody } from "@/server/api/helpers";
import {
  API_TOKEN_SCOPES,
  ApiTokenError,
  createApiToken,
  listApiTokens,
} from "@/server/auth/api-token";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(API_TOKEN_SCOPES)).max(10).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

/** Token management requires a browser session; an API token cannot mint another token. */
function requireSession() {
  if (headers().get("authorization")) {
    return apiFail(403, "SESSION_REQUIRED", "API Token 管理需要浏览器登录会话，不能用 Token 自身创建新 Token。");
  }
  return null;
}

export async function GET() {
  const blocked = requireSession();
  if (blocked) return blocked;
  return withAuth(async ({ workspaceId }) => {
    const tokens = await listApiTokens(workspaceId);
    return { tokens };
  });
}

export async function POST(request: Request) {
  const blocked = requireSession();
  if (blocked) return blocked;
  return withAuth(async ({ user, workspaceId }) => {
    try {
      const body = await parseBody(request, createSchema);
      const expiresAt = body.expiresInDays
        ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
        : null;
      const { token, record } = await createApiToken({
        workspaceId,
        userId: user.id,
        name: body.name,
        scopes: body.scopes,
        expiresAt,
      });
      return NextResponse.json({
        ok: true,
        data: {
          token,
          id: record.id,
          name: record.name,
          prefix: record.prefix,
          scopes: record.scopes,
          expiresAt: record.expiresAt,
          warning: "Token 只显示一次，请现在保存；之后只能看到前缀。",
        },
      });
    } catch (error) {
      if (error instanceof ApiTokenError) return apiFail(400, error.code, error.message);
      throw error;
    }
  });
}
