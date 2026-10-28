import { env } from "@/lib/env";
import { MockSearchProvider } from "@/lib/providers/mock/mock-search.provider";
import { YuanbaoSearchProvider } from "@/lib/providers/yuanbao/yuanbao-search.provider";
import type { ProviderName, SearchProvider } from "@/lib/providers/types";
import { CredentialEncryptionError, decryptSecret, isEncryptionConfigured } from "@/server/security/crypto";
import { prisma } from "@/server/db/client";

export interface ProviderContext {
  workspaceId: string;
  provider: ProviderName;
}

/**
 * 根据工作空间凭据构建 Provider 实例。
 * - YUANBAO：从数据库读取加密密文并在服务端解密；解密失败抛出 CredentialEncryptionError。
 * - MOCK：无需凭据。
 */
export async function createProvider(ctx: ProviderContext): Promise<SearchProvider> {
  if (ctx.provider === "MOCK") return new MockSearchProvider();
  const credential = await prisma.searchProviderCredential.findUnique({
    where: { workspaceId: ctx.workspaceId },
  });
  if (!credential || credential.provider !== "YUANBAO") {
    return new YuanbaoSearchProvider({
      credentialConnected: false,
      globallyEnabled: env.yuanbaoSearchEnabled,
    });
  }
  let apiKey: string | undefined;
  if (credential.encryptedSecret) {
    if (!isEncryptionConfigured()) {
      throw new CredentialEncryptionError(
        "未配置 CREDENTIAL_ENCRYPTION_KEY，无法解密已保存的密钥；请检查服务端环境变量。"
      );
    }
    apiKey = decryptSecret(credential.encryptedSecret);
  }
  return new YuanbaoSearchProvider({
    apiKey,
    credentialConnected: credential.status === "CONNECTED",
    globallyEnabled: env.yuanbaoSearchEnabled,
  });
}
