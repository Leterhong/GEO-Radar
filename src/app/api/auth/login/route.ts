import { prisma } from "@/server/db/client";
import { verifyPassword } from "@/server/auth/password";
import { createSession, isSecureRequest } from "@/server/auth/session";
import { parseBody, rateLimit, apiFail, handleApiError, writeAuditLog } from "@/server/api/helpers";
import { loginSchema } from "@/lib/validation/schemas";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


export async function POST(request: Request) {
  try {
    const body = await parseBody(request, loginSchema);
    // 按邮箱限流，避免局域网/本机所有用户共享同一个 "local" 计数桶而互相阻塞
    rateLimit(`login:${body.email}`, 20, 15 * 60 * 1000);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      return apiFail(401, "INVALID_CREDENTIALS", "邮箱或密码不正确。");
    }
    await createSession(user.id, { secure: isSecureRequest(request) });
    await writeAuditLog({ userId: user.id, action: "USER_LOGIN" });
    const membership = await prisma.workspaceMember.findFirst({ where: { userId: user.id } });
    return NextResponse.json({ ok: true, data: { workspaceId: membership?.workspaceId ?? null } });
  } catch (error) {
    return handleApiError(error);
  }
}
