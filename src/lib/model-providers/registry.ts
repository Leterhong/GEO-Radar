import { prisma } from "@/server/db/client";
import { CredentialEncryptionError, decryptSecret, isEncryptionConfigured } from "@/server/security/crypto";
import { OpenAICompatibleAdapter } from "./openai-compatible";
import type { ModelAdapter } from "./types";
import type { ModelProviderCredential } from "@prisma/client";

export interface ModelProviderStatus {
  configured: boolean;
  connected: boolean;
  enabled: boolean;
  provider: string;
  baseUrl: string | null;
  modelName: string | null;
}

/** 从工作空间凭据构建模型适配器；未配置时抛出带用户提示的错误。 */
export async function createModelAdapter(workspaceId: string): Promise<ModelAdapter> {
  const credential = await prisma.modelProviderCredential.findUnique({ where: { workspaceId } });
  if (!credential?.encryptedSecret) {
    throw new CredentialEncryptionError(
      "尚未配置大模型：请先在「设置 → 大模型」填写 Base URL、模型名称与 API Key。"
    );
  }
  if (credential.status === "DISABLED") {
    throw new CredentialEncryptionError("大模型数据源已被禁用，无法执行生成。");
  }
  if (!isEncryptionConfigured()) {
    throw new CredentialEncryptionError("未配置 CREDENTIAL_ENCRYPTION_KEY，无法解密模型密钥。");
  }
  const apiKey = decryptSecret(credential.encryptedSecret);
  const params = (credential.publicParams ?? {}) as { temperature?: number; maxTokens?: number };
  return new OpenAICompatibleAdapter({
    baseUrl: credential.baseUrl,
    apiKey,
    model: credential.modelName,
    temperature: params.temperature,
    maxTokens: params.maxTokens,
  });
}

export async function getModelCredentialForStatus(workspaceId: string): Promise<ModelProviderCredential | null> {
  return prisma.modelProviderCredential.findUnique({ where: { workspaceId } });
}
