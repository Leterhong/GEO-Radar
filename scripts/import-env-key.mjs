/**
 * 从环境变量引导元宝 API Key：加密写入指定账号的工作空间，并执行一次真实连接测试。
 *
 * 用法：
 *   node scripts/import-env-key.mjs <账号邮箱>
 *
 * 前置：`.env.local` 中设置 YUANBAO_SEARCH_API_KEY（该文件已被 .gitignore 排除）。
 * 说明：运行期只读取数据库密文；本脚本只做一次性导入，不会把明文写入日志。
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto";

// 极简 .env.local 读取（避免额外依赖）
function loadEnvLocal() {
  const file = path.resolve(".env.local");
  const text = readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvLocal();

const email = process.argv[2];
if (!email) {
  console.error("用法: node scripts/import-env-key.mjs <账号邮箱>");
  process.exit(1);
}
const apiKey = process.env.YUANBAO_SEARCH_API_KEY;
if (!apiKey) {
  console.error("未找到 YUANBAO_SEARCH_API_KEY，请先写入 .env.local（该文件不入 Git）。");
  process.exit(1);
}
const rawKey = process.env.CREDENTIAL_ENCRYPTION_KEY ?? "";
const encryptionKey =
  /^[0-9a-fA-F]{64}$/.test(rawKey) ? Buffer.from(rawKey, "hex") : Buffer.from(rawKey, "base64");
if (encryptionKey.length !== 32) {
  console.error("CREDENTIAL_ENCRYPTION_KEY 缺失或长度不正确（需要 32 字节）。");
  process.exit(1);
}

function encryptSecret(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;
}
function maskSecret(value) {
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}

const prisma = new PrismaClient();
const user = await prisma.user.findUnique({
  where: { email: email.trim().toLowerCase() },
  include: { workspaceLinks: { orderBy: { joinedAt: "asc" } } },
});
if (!user) {
  console.error(`未找到账号 ${email}，请先在页面上注册。`);
  await prisma.$disconnect();
  process.exit(1);
}
const member = user.workspaceLinks[0];
if (!member) {
  console.error("该账号还没有工作空间。");
  await prisma.$disconnect();
  process.exit(1);
}

const masked = maskSecret(apiKey);
await prisma.searchProviderCredential.upsert({
  where: { workspaceId: member.workspaceId },
  create: {
    workspaceId: member.workspaceId,
    provider: "YUANBAO",
    encryptedSecret: encryptSecret(apiKey),
    maskedSecret: masked,
    status: "PENDING_VERIFICATION",
    updatedById: user.id,
  },
  update: {
    encryptedSecret: encryptSecret(apiKey),
    maskedSecret: masked,
    status: "PENDING_VERIFICATION",
    lastTestOk: null,
    lastErrorMessage: null,
    updatedById: user.id,
  },
});
console.log(`已加密写入工作空间 ${member.workspaceId}，掩码 ${masked}`);
console.log("下一步：登录该账号，在「设置 → 元宝搜索数据源」点击「测试连接」完成真实验证。");
await prisma.$disconnect();
