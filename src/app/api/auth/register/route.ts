import { prisma } from "@/server/db/client";
import { hashPassword } from "@/server/auth/password";
import { createSession, setActiveWorkspace, isSecureRequest } from "@/server/auth/session";
import { parseBody, rateLimit, apiFail, handleApiError, writeAuditLog } from "@/server/api/helpers";
import { registerSchema } from "@/lib/validation/schemas";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


export async function POST(request: Request) {
  try {
    const body = await parseBody(request, registerSchema);
    rateLimit(`register:${body.email}`, 10, 60 * 60 * 1000);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      return apiFail(409, "EMAIL_EXISTS", "该邮箱已注册，请直接登录。");
    }
    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: { email: body.email, passwordHash, name: body.name },
    });
    const workspace = await prisma.workspace.create({
      data: { name: `${body.name} 的工作空间`, ownerId: user.id },
    });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: user.id, role: "OWNER" },
    });
    const secure = isSecureRequest(request);
    await createSession(user.id, { secure });
    // 默认工作空间已创建，直接设为当前空间，注册后即可进入首页
    await setActiveWorkspace(workspace.id, { secure });
    await writeAuditLog({ workspaceId: workspace.id, userId: user.id, action: "USER_REGISTERED" });
    return NextResponse.json({ ok: true, data: { workspaceId: workspace.id } });
  } catch (error) {
    return handleApiError(error);
  }
}
