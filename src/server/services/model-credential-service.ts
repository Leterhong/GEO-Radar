import { prisma } from "@/server/db/client";
import {
  CredentialEncryptionError,
  encryptSecret,
  isEncryptionConfigured,
  maskSecret,
} from "@/server/security/crypto";
import { createModelAdapter } from "@/lib/model-providers/registry";
import { writeAuditLog } from "@/server/api/helpers";
import type { ModelCredentialStatus } from "@prisma/client";

export interface MaskedModelConfig {
  provider: "OPENAI_COMPATIBLE";
  configured: boolean;
  status: ModelCredentialStatus;
  displayName: string | null;
  baseUrl: string | null;
  modelName: string | null;
  maskedKey: string | null;
  updatedAt: string | null;
  lastTestedAt: string | null;
  lastTestDurationMs: number | null;
  lastTestOk: boolean | null;
  lastErrorMessage: string | null;
  encryptionConfigured: boolean;
}

const BASE_URL_RE = /^https?:\/\/[^\s]+$/i;

export async function getMaskedModelConfig(workspaceId: string): Promise<MaskedModelConfig> {
  const c = await prisma.modelProviderCredential.findUnique({ where: { workspaceId } });
  return {
    provider: "OPENAI_COMPATIBLE",
    configured: Boolean(c?.encryptedSecret),
    status: c?.status ?? "NOT_CONFIGURED",
    displayName: c?.displayName ?? null,
    baseUrl: c?.baseUrl ?? null,
    modelName: c?.modelName ?? null,
    maskedKey: c?.maskedSecret ?? null,
    updatedAt: c?.updatedAt.toISOString() ?? null,
    lastTestedAt: c?.lastTestedAt?.toISOString() ?? null,
    lastTestDurationMs: c?.lastTestDurationMs ?? null,
    lastTestOk: c?.lastTestOk ?? null,
    lastErrorMessage: c?.lastErrorMessage ?? null,
    encryptionConfigured: isEncryptionConfigured(),
  };
}

export interface SaveModelConfigInput {
  displayName?: string;
  baseUrl: string;
  modelName: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
}

export async function saveModelConfig(
  workspaceId: string,
  userId: string,
  input: SaveModelConfigInput
): Promise<{ maskedKey: string }> {
  if (!isEncryptionConfigured()) {
    throw new CredentialEncryptionError(
      "未配置 CREDENTIAL_ENCRYPTION_KEY，拒绝保存密钥（不允许明文存储）。"
    );
  }
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
  if (!BASE_URL_RE.test(baseUrl)) {
    throw new CredentialEncryptionError("API Base URL 格式不正确（需要 http/https 地址）。");
  }
  if (input.modelName.trim() === "") {
    throw new CredentialEncryptionError("模型名称不能为空。");
  }
  if (input.apiKey.trim().length < 8) {
    throw new CredentialEncryptionError("API Key 长度不符合预期，请确认复制完整。");
  }
  const encrypted = encryptSecret(input.apiKey.trim());
  const masked = maskSecret(input.apiKey.trim());
  const publicParams: Record<string, unknown> = {};
  if (typeof input.temperature === "number") publicParams.temperature = input.temperature;
  if (typeof input.maxTokens === "number") publicParams.maxTokens = input.maxTokens;
  await prisma.modelProviderCredential.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      provider: "OPENAI_COMPATIBLE",
      displayName: input.displayName || undefined,
      baseUrl,
      modelName: input.modelName.trim(),
      publicParams: publicParams as never,
      encryptedSecret: encrypted,
      maskedSecret: masked,
      status: "PENDING_VERIFICATION",
      updatedById: userId,
    },
    update: {
      displayName: input.displayName || undefined,
      baseUrl,
      modelName: input.modelName.trim(),
      publicParams: publicParams as never,
      encryptedSecret: encrypted,
      maskedSecret: masked,
      status: "PENDING_VERIFICATION",
      lastTestOk: null,
      lastErrorMessage: null,
      updatedById: userId,
    },
  });
  await writeAuditLog({
    workspaceId,
    userId,
    action: "MODEL_CREDENTIAL_SAVED",
    targetType: "ModelProviderCredential",
    targetId: workspaceId,
    metadata: { baseUrl, model: input.modelName, maskedKey: masked },
  });
  return { maskedKey: masked };
}

export async function clearModelConfig(workspaceId: string, userId: string): Promise<void> {
  await prisma.modelProviderCredential.updateMany({
    where: { workspaceId },
    data: {
      encryptedSecret: null,
      maskedSecret: null,
      status: "NOT_CONFIGURED",
      lastTestOk: null,
      lastTestedAt: null,
      lastTestDurationMs: null,
      lastErrorMessage: null,
      updatedById: userId,
    },
  });
  await writeAuditLog({ workspaceId, userId, action: "MODEL_CREDENTIAL_CLEARED" });
}

export interface TestModelOutcome {
  success: boolean;
  testedAt: string;
  durationMs: number | null;
  model: string | null;
  errorCategory: string | null;
  errorMessage: string | null;
  madeRealRequest: boolean;
}

/** 连接测试：向模型服务发起一次最小真实请求（少量 Token 消耗）。 */
export async function testModelConnection(workspaceId: string, userId: string): Promise<TestModelOutcome> {
  const credential = await prisma.modelProviderCredential.findUnique({ where: { workspaceId } });
  if (!credential?.encryptedSecret) {
    return {
      success: false,
      testedAt: new Date().toISOString(),
      durationMs: null,
      model: null,
      errorCategory: "NOT_CONFIGURED",
      errorMessage: "尚未保存模型 API Key：请先填写并保存，再执行连接测试。",
      madeRealRequest: false,
    };
  }
  try {
    const adapter = await createModelAdapter(workspaceId);
    const result = await adapter.testConnection();
    const nextStatus: ModelCredentialStatus = result.success ? "CONNECTED" : "FAILED";
    await prisma.modelProviderCredential.update({
      where: { workspaceId },
      data: {
        status: nextStatus,
        lastTestedAt: new Date(),
        lastTestDurationMs: result.durationMs,
        lastTestOk: result.success,
        lastErrorMessage: result.success ? null : (result.error?.userMessage ?? "连接测试失败"),
      },
    });
    await writeAuditLog({
      workspaceId,
      userId,
      action: result.success ? "MODEL_CREDENTIAL_TEST_OK" : "MODEL_CREDENTIAL_TEST_FAILED",
      metadata: { durationMs: result.durationMs, model: result.model },
    });
    return {
      success: result.success,
      testedAt: new Date().toISOString(),
      durationMs: result.durationMs,
      model: result.model,
      errorCategory: result.error?.category ?? null,
      errorMessage: result.error?.userMessage ?? null,
      madeRealRequest: true,
    };
  } catch (error) {
    const message =
      error instanceof CredentialEncryptionError
        ? error.message
        : "连接测试失败，请检查配置。";
    await prisma.modelProviderCredential.update({
      where: { workspaceId },
      data: {
        status: "FAILED",
        lastTestedAt: new Date(),
        lastTestOk: false,
        lastErrorMessage: message,
      },
    });
    return {
      success: false,
      testedAt: new Date().toISOString(),
      durationMs: null,
      model: credential.modelName,
      errorCategory: "PROVIDER_ERROR",
      errorMessage: message,
      madeRealRequest: false,
    };
  }
}
