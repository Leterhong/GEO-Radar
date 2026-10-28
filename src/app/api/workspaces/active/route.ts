import { prisma } from "@/server/db/client";
import { getCurrentUser, setActiveWorkspace, isSecureRequest } from "@/server/auth/session";
import { handleApiError, apiFail, parseBody, writeAuditLog } from "@/server/api/helpers";
import { NextResponse } from "next/server";
import { z } from "zod";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


const schema = z.object({ workspaceId: z.string().min(1) });

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiFail(401, "UNAUTHENTICATED", "请先登录。");
    const body = await parseBody(request, schema);
    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: body.workspaceId, userId: user.id } },
    });
    if (!membership) return apiFail(403, "FORBIDDEN", "你不是该工作空间的成员。");
    await setActiveWorkspace(body.workspaceId, { secure: isSecureRequest(request) });
    await writeAuditLog({
      workspaceId: body.workspaceId,
      userId: user.id,
      action: "WORKSPACE_SWITCHED",
    });
    return NextResponse.json({ ok: true, data: { workspaceId: body.workspaceId } });
  } catch (error) {
    return handleApiError(error);
  }
}
