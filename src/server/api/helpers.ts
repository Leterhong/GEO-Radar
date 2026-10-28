import { NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import { prisma } from "@/server/db/client";
import { getCurrentUser, getActiveWorkspaceId } from "@/server/auth/session";
import { resolveApiToken, ApiTokenError } from "@/server/auth/api-token";
import type { User } from "@prisma/client";

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export function apiOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function apiFail(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status }
  );
}

export function handleApiError(error: unknown) {
  if (error instanceof ApiError) {
    return apiFail(error.status, error.code, error.message, error.details);
  }
  if (error instanceof ZodError) {
    return apiFail(400, "VALIDATION_ERROR", "请求参数校验失败", error.flatten());
  }
  console.error("[api] 未处理错误:", error instanceof Error ? error.message : error);
  return apiFail(500, "INTERNAL_ERROR", "服务器内部错误，请稍后重试。");
}

export async function withAuth<T>(
  handler: (ctx: { user: User; workspaceId: string }) => Promise<T>
): Promise<NextResponse> {
  try {
    let user: User | null = null;
    let workspaceId: string | null = null;

    try {
      const tokenContext = await resolveApiToken();
      if (tokenContext) {
        user = tokenContext.user;
        workspaceId = tokenContext.workspaceId;
      }
    } catch (error) {
      if (error instanceof ApiTokenError) {
        return apiFail(401, error.code, error.message);
      }
      throw error;
    }

    // Cookie session fallback. A malformed Bearer token must not silently fall back.
    if (!user) {
      user = await getCurrentUser();
      if (!user) return apiFail(401, "UNAUTHENTICATED", "请先登录，或使用 Bearer API Token。");
      workspaceId = await getActiveWorkspaceId(user.id);
      if (!workspaceId) return apiFail(403, "NO_WORKSPACE", "尚未创建工作空间。");
    }
    if (!user || !workspaceId) return apiFail(401, "UNAUTHENTICATED", "无法解析登录身份。");

    const data = await handler({ user, workspaceId });
    if (data instanceof NextResponse) return data;
    return apiOk(data);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function parseBody<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "请求体不是有效的 JSON。");
  }
  return schema.parse(json);
}

// —— 简单内存限流：适用于单实例部署；多实例部署需替换为共享存储实现 ——
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new ApiError(429, "RATE_LIMITED", "操作过于频繁，请稍后再试。");
  }
}

export async function writeAuditLog(entry: {
  workspaceId?: string | null;
  userId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        workspaceId: entry.workspaceId ?? null,
        userId: entry.userId ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        metadata: entry.metadata as never,
      },
    });
  } catch (error) {
    console.error("[audit] 写入审计日志失败:", error instanceof Error ? error.message : error);
  }
}
