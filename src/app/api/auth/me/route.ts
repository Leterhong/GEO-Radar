import { getCurrentUser } from "@/server/auth/session";
import { handleApiError } from "@/server/api/helpers";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ ok: true, data: { user: null } });
    return NextResponse.json({
      ok: true,
      data: { user: { id: user.id, email: user.email, name: user.name } },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
