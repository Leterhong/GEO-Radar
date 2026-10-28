#!/usr/bin/env node
/**
 * Create a workspace API token for MCP / CLI / agent skills.
 *
 * Usage:
 *   npm run token:create -- user@example.com "MCP token"
 *   npm run token:create -- user@example.com "MCP token" --expires-days 30
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const envFile = resolve(".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

const [email, name = "MCP token", ...rest] = process.argv.slice(2);
if (!email) {
  console.error('用法: npm run token:create -- <email> "<name>" [--expires-days 30]');
  process.exit(1);
}
const expiresIndex = rest.indexOf("--expires-days");
const expiresDays = expiresIndex >= 0 ? Number(rest[expiresIndex + 1]) : undefined;
if (expiresDays !== undefined && (!Number.isInteger(expiresDays) || expiresDays < 1 || expiresDays > 365)) {
  console.error("--expires-days 必须是 1-365 的整数");
  process.exit(1);
}

const prisma = new PrismaClient();
const user = await prisma.user.findUnique({
  where: { email: email.trim().toLowerCase() },
  include: { workspaceLinks: { include: { workspace: true }, take: 1 } },
});
if (!user) {
  console.error(`未找到账号: ${email}`);
  await prisma.$disconnect();
  process.exit(1);
}
const workspace = user.workspaceLinks[0]?.workspace;
if (!workspace) {
  console.error("该账号没有工作空间");
  await prisma.$disconnect();
  process.exit(1);
}

const token = `gr_${randomBytes(32).toString("base64url")}`;
const prefix = token.slice(0, 12);
const tokenHash = createHash("sha256").update(token).digest("hex");
await prisma.apiToken.create({
  data: {
    workspaceId: workspace.id,
    userId: user.id,
    name: name.trim() || "MCP token",
    prefix,
    tokenHash,
    scopes: ["read", "write", "tasks:run", "reports:write"],
    expiresAt: expiresDays ? new Date(Date.now() + expiresDays * 86400000) : null,
  },
});

console.log("GEO Radar API Token created");
console.log("  workspace:", workspace.name, `(${workspace.id})`);
console.log("  prefix:   ", prefix);
console.log("  token:    ", token);
console.log("");
console.log("只显示这一次。请保存到环境变量：");
console.log(`  GEO_RADAR_TOKEN=${token}`);
console.log(`  GEO_RADAR_URL=http://127.0.0.1:3000`);
await prisma.$disconnect();
