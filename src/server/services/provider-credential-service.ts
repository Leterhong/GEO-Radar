import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import {
  CredentialEncryptionError,
  encryptSecret,
  isEncryptionConfigured,
  maskSecret,
} from "@/server/security/crypto";
import { createProvider } from "@/lib/providers/registry";
import { writeAuditLog } from "@/server/api/helpers";
import type { CredentialStatus } from "@prisma/client";

export interface MaskedCredentialConfig {
  provider: "YUANBAO";
  configured: boolean;
  status: CredentialStatus;
  maskedKey: string | null;
  updatedAt: string | null;
  lastTestedAt: string | null;
  lastTestDurationMs: number | null;
  lastTestRequestId: string | null;
  lastTestOk: boolean | null;
  lastErrorMessage: string | null;
  globallyEnabled: boolean;
  encryptionConfigured: boolean;
}

/** 读取脱敏后的凭据配置（前端永远拿不到完整密钥）。 */
export async function getMaskedCredentialConfig(workspaceId: string): Promise<MaskedCredentialConfig> {
  const credential = await prisma.searchProviderCredential.findUnique({
    where: { workspaceId },
  });
  return {
    provider: "YUANBAO",
    configured: Boolean(credential?.encryptedSecret),
    status: credential?.status ?? "NOT_CONFIGURED",
    maskedKey: credential?.maskedSecret ?? null,
    updatedAt: credential?.updatedAt.toISOString() ?? null,
    lastTestedAt: credential?.lastTestedAt?.toISOString() ?? null,
    lastTestDurationMs: credential?.lastTestDurationMs ?? null,
    lastTestRequestId: credential?.lastTestRequestId ?? null,
    lastTestOk: credential?.lastTestOk ?? null,
    lastErrorMessage: credential?.lastErrorMessage ?? null,
    globallyEnabled: env.yuanbaoSearchEnabled,
    encryptionConfigured: isEncryptionConfigured(),
  };
}

/** 保存 API Key：服务端加密存储；不返回完整密钥；保存后状态回到 PENDING_VERIFICATION。 */
export async function saveCredential(
  workspaceId: string,
  userId: string,
  apiKey: string
): Promise<{ maskedKey: string }> {
  if (!isEncryptionConfigured()) {
    throw new CredentialEncryptionError(
      "未配置 CREDENTIAL_ENCRYPTION_KEY，拒绝保存密钥（不允许静默降级为明文存储）。"
    );
  }
  const key = apiKey.trim();
  if (key.length < 8) {
    throw new CredentialEncryptionError("API Key 长度不符合预期，请确认复制完整。");
  }
  const encrypted = encryptSecret(key);
  const masked = maskSecret(key);
  await prisma.searchProviderCredential.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      provider: "YUANBAO",
      encryptedSecret: encrypted,
      maskedSecret: masked,
      status: "PENDING_VERIFICATION",
      lastTestOk: null,
      lastErrorMessage: null,
      updatedById: userId,
    },
    update: {
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
    action: "CREDENTIAL_SAVED",
    targetType: "SearchProviderCredential",
    targetId: workspaceId,
    metadata: { provider: "YUANBAO", maskedKey: masked },
  });
  return { maskedKey: masked };
}

/** 清除密钥：删除密文并重置状态为 NOT_CONFIGURED。 */
export async function clearCredential(workspaceId: string, userId: string): Promise<void> {
  await prisma.searchProviderCredential.updateMany({
    where: { workspaceId },
    data: {
      encryptedSecret: null,
      maskedSecret: null,
      status: "NOT_CONFIGURED",
      lastTestOk: null,
      lastTestedAt: null,
      lastTestDurationMs: null,
      lastTestRequestId: null,
      lastErrorMessage: null,
      updatedById: userId,
    },
  });
  await writeAuditLog({
    workspaceId,
    userId,
    action: "CREDENTIAL_CLEARED",
    targetType: "SearchProviderCredential",
    targetId: workspaceId,
  });
}

/** 禁用/启用数据源。 */
export async function setCredentialDisabled(
  workspaceId: string,
  userId: string,
  disabled: boolean
): Promise<void> {
  const credential = await prisma.searchProviderCredential.findUnique({ where: { workspaceId } });
  if (!credential) throw new Error("尚未配置数据源");
  const nextStatus: CredentialStatus = disabled
    ? "DISABLED"
    : credential.lastTestOk === true
      ? "CONNECTED"
      : credential.encryptedSecret
        ? "PENDING_VERIFICATION"
        : "NOT_CONFIGURED";
  await prisma.searchProviderCredential.update({
    where: { workspaceId },
    data: { status: nextStatus, updatedById: userId },
  });
  await writeAuditLog({
    workspaceId,
    userId,
    action: disabled ? "CREDENTIAL_DISABLED" : "CREDENTIAL_ENABLED",
    targetType: "SearchProviderCredential",
    targetId: workspaceId,
  });
}

export interface TestConnectionOutcome {
  success: boolean;
  testedAt: string;
  durationMs: number | null;
  requestId: string | null;
  providerVersion: string | null;
  resultCount: number | null;
  errorCategory: string | null;
  errorMessage: string | null;
  madeRealRequest: boolean;
}

/**
 * 连接测试：使用已保存密钥发起一次真实最小搜索（Query-only）。
 * 会产生真实计费请求；只有真实成功才将状态置为 CONNECTED。
 */
export async function testCredentialConnection(
  workspaceId: string,
  userId: string
): Promise<TestConnectionOutcome> {
  const credential = await prisma.searchProviderCredential.findUnique({ where: { workspaceId } });
  if (!credential?.encryptedSecret) {
    return {
      success: false,
      testedAt: new Date().toISOString(),
      durationMs: null,
      requestId: null,
      providerVersion: null,
      resultCount: null,
      errorCategory: "NOT_CONFIGURED",
      errorMessage: "尚未保存 API Key：请先填写并保存，再执行连接测试。",
      madeRealRequest: false,
    };
  }
  if (!env.yuanbaoSearchEnabled) {
    return {
      success: false,
      testedAt: new Date().toISOString(),
      durationMs: null,
      requestId: null,
      providerVersion: null,
      resultCount: null,
      errorCategory: "DISABLED",
      errorMessage: "元宝搜索数据源未启用（YUANBAO_SEARCH_ENABLED=false）。",
      madeRealRequest: false,
    };
  }
  const provider = await createProvider({ workspaceId, provider: "YUANBAO" });
  const result = await provider.testConnection();
  const nextStatus: CredentialStatus = result.success ? "CONNECTED" : "FAILED";
  await prisma.searchProviderCredential.update({
    where: { workspaceId },
    data: {
      status: nextStatus,
      lastTestedAt: new Date(result.testedAt),
      lastTestDurationMs: result.durationMs ?? null,
      lastTestRequestId: result.providerRequestId ?? null,
      lastTestOk: result.success,
      lastErrorMessage: result.success ? null : (result.error?.userMessage ?? "连接测试失败"),
      updatedById: userId,
    },
  });
  await writeAuditLog({
    workspaceId,
    userId,
    action: result.success ? "CREDENTIAL_TEST_OK" : "CREDENTIAL_TEST_FAILED",
    targetType: "SearchProviderCredential",
    targetId: workspaceId,
    metadata: {
      durationMs: result.durationMs ?? null,
      requestId: result.providerRequestId ?? null,
      errorCategory: result.error?.category ?? null,
      madeRealRequest: result.madeRealRequest,
    },
  });
  return {
    success: result.success,
    testedAt: result.testedAt,
    durationMs: result.durationMs ?? null,
    requestId: result.providerRequestId ?? null,
    providerVersion: result.providerVersion ?? null,
    resultCount: result.resultCount ?? null,
    errorCategory: result.error?.category ?? null,
    errorMessage: result.error?.userMessage ?? null,
    madeRealRequest: result.madeRealRequest,
  };
}
