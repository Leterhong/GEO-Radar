import { destroySession, getCurrentUser } from "@/server/auth/session";
import { handleApiError, writeAuditLog } from "@/server/api/helpers";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


export async function POST() {
  try {
    const user = await getCurrentUser();
    await destroySession();
    if (user) await writeAuditLog({ userId: user.id, action: "USER_LOGOUT" });
    return NextResponse.json({ ok: true, data: {} });
  } catch (error) {
    return handleApiError(error);
  }
}
