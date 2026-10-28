import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";

const SESSION_COOKIE = "georadar_session";
const WORKSPACE_COOKIE = "georadar_workspace";
const SESSION_TTL_DAYS = 30;

function hashToken(token: string): string {
  return createHash("sha256").update(`${token}:${env.authSecret}`).digest("hex");
}

export async function createSession(userId: string, options: { secure?: boolean } = {}): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt },
  });
  const cookieStore = cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // 仅 HTTPS 请求设置 Secure；HTTP 局域网访问时 Secure Cookie 会被浏览器拒绝，
    // 表现为“登录成功但立刻回到登录页”。
    secure: options.secure ?? env.isProduction,
    path: "/",
    expires: expiresAt,
  });
}

/** 根据请求协议（含反向代理 x-forwarded-proto）判断是否应使用 Secure Cookie。 */
export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim().toLowerCase() === "https";
  }
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export async function getCurrentUser() {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

export async function destroySession(): Promise<void> {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(WORKSPACE_COOKIE);
}

export async function setActiveWorkspace(workspaceId: string, options: { secure?: boolean } = {}): Promise<void> {
  const cookieStore = cookies();
  cookieStore.set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: options.secure ?? env.isProduction,
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export async function getActiveWorkspaceId(userId: string): Promise<string | null> {
  const cookieStore = cookies();
  const fromCookie = cookieStore.get(WORKSPACE_COOKIE)?.value;
  if (fromCookie) {
    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: fromCookie, userId } },
    });
    if (membership) return fromCookie;
  }
  const first = await prisma.workspaceMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: "asc" },
  });
  return first?.workspaceId ?? null;
}
