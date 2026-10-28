import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import type { User } from "@prisma/client";
import { prisma } from "@/server/db/client";

/**
 * Workspace API tokens are for MCP / CLI / agent skills.
 * Plaintext is returned only once; only a SHA-256 hash is stored.
 */

export const API_TOKEN_PREFIX = "gr_";
export const API_TOKEN_SCOPES = ["read", "write", "tasks:run", "reports:write"] as const;

export class ApiTokenError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export function generateApiToken(): string {
  return `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function apiTokenPrefix(token: string): string {
  return token.slice(0, 12);
}

export interface ApiTokenContext {
  user: User;
  workspaceId: string;
  tokenId: string;
  scopes: string[];
}

/**
 * Resolve a Bearer token from the current request headers.
 * Returns null when the request has no Authorization header.
 * Throws ApiTokenError for a malformed/revoked/expired token.
 */
export async function resolveApiToken(): Promise<ApiTokenContext | null> {
  const header = headers().get("authorization");
  if (!header) return null;
  if (!header.toLowerCase().startsWith("bearer ")) {
    throw new ApiTokenError("INVALID_AUTH_HEADER", "Authorization 必须使用 Bearer <token>。");
  }
  const token = header.slice(7).trim();
  if (!token.startsWith(API_TOKEN_PREFIX)) {
    throw new ApiTokenError("INVALID_TOKEN", "API Token 格式不正确。");
  }
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: hashApiToken(token) },
    include: { user: true },
  });
  if (!row) throw new ApiTokenError("INVALID_TOKEN", "API Token 不存在或已被撤销。");
  if (row.expiresAt && row.expiresAt < new Date()) {
    throw new ApiTokenError("TOKEN_EXPIRED", "API Token 已过期。");
  }
  await prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {
    // lastUsedAt is observability; never fail a request because it could not be updated.
  });
  return { user: row.user, workspaceId: row.workspaceId, tokenId: row.id, scopes: row.scopes };
}

export async function createApiToken(input: {
  workspaceId: string;
  userId: string;
  name: string;
  scopes?: string[];
  expiresAt?: Date | null;
}) {
  const name = input.name.trim();
  if (!name) throw new ApiTokenError("INVALID_NAME", "Token 名称不能为空。");
  const scopes = input.scopes?.length ? input.scopes : [...API_TOKEN_SCOPES];
  const unknown = scopes.filter((scope) => !API_TOKEN_SCOPES.includes(scope as never));
  if (unknown.length) throw new ApiTokenError("INVALID_SCOPE", `未知 scope: ${unknown.join(", ")}`);
  const token = generateApiToken();
  const row = await prisma.apiToken.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      name,
      prefix: apiTokenPrefix(token),
      tokenHash: hashApiToken(token),
      scopes,
      expiresAt: input.expiresAt ?? null,
    },
  });
  return { token, record: row };
}

export async function listApiTokens(workspaceId: string) {
  return prisma.apiToken.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
      user: { select: { id: true, email: true, name: true } },
    },
  });
}

export async function revokeApiToken(workspaceId: string, tokenId: string) {
  const row = await prisma.apiToken.findFirst({ where: { id: tokenId, workspaceId } });
  if (!row) throw new ApiTokenError("TOKEN_NOT_FOUND", "Token 不存在或不属于当前工作空间。");
  await prisma.apiToken.delete({ where: { id: row.id } });
}
