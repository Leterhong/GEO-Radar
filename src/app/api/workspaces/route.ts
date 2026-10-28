import { prisma } from "@/server/db/client";
import { getCurrentUser } from "@/server/auth/session";
import { handleApiError, apiFail, parseBody } from "@/server/api/helpers";
import { workspaceCreateSchema } from "@/lib/validation/schemas";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


/** 当前用户的工作空间列表。 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return apiFail(401, "UNAUTHENTICATED", "请先登录。");
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: user.id },
      include: { workspace: { select: { id: true, name: true } } },
      orderBy: { joinedAt: "asc" },
    });
    return NextResponse.json({
      ok: true,
      data: { workspaces: memberships.map((m) => m.workspace) },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/** 创建新工作空间（创建者自动成为 OWNER）。 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiFail(401, "UNAUTHENTICATED", "请先登录。");
    const body = await parseBody(request, workspaceCreateSchema);
    const workspace = await prisma.workspace.create({
      data: { name: body.name, ownerId: user.id },
    });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: user.id, role: "OWNER" },
    });
    return NextResponse.json({ ok: true, data: workspace });
  } catch (error) {
    return handleApiError(error);
  }
}
