import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { env } from "@/lib/env";

// API Key 等敏感凭据使用 AES-256-GCM 加密存储。
// 加密密钥通过独立环境变量 CREDENTIAL_ENCRYPTION_KEY 提供（64 位 hex = 32 字节，或 32 字节 base64）。
// 数据库中只保存密文，格式: v1:<ivHex>:<authTagHex>:<cipherHex>

export class CredentialEncryptionError extends Error {}

function loadKey(): Buffer {
  const raw = env.credentialEncryptionKey;
  if (!raw) {
    throw new CredentialEncryptionError(
      "未配置 CREDENTIAL_ENCRYPTION_KEY，无法安全存储密钥。请使用 `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"` 生成 32 字节密钥并写入服务端环境变量。"
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;
  throw new CredentialEncryptionError(
    "CREDENTIAL_ENCRYPTION_KEY 格式不正确：需要 32 字节（64 位 hex 或 base64）。"
  );
}

export function isEncryptionConfigured(): boolean {
  return env.credentialEncryptionKey !== undefined;
}

export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(payload: string): string {
  const key = loadKey();
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new CredentialEncryptionError("密文格式不正确，无法解密。");
  }
  const [, ivHex, tagHex, cipherHex] = parts as [string, string, string, string];
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    throw new CredentialEncryptionError("解密失败：密文可能已被篡改或加密密钥已更换。");
  }
}

// 掩码展示：仅保留开头与结尾少量字符，用于前端显示。
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 8) return "••••••••";
  return `${plaintext.slice(0, 4)}••••••••${plaintext.slice(-4)}`;
}
