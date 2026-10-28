import { prisma } from "@/server/db/client";
import { createProvider } from "@/lib/providers/registry";
import type { SearchProvider } from "@/lib/providers/types";
import { detectMention } from "@/server/services/mention-detection";
import { env } from "@/lib/env";
import { registerSecret } from "@/server/security/logger";
import { decryptSecret, isEncryptionConfigured } from "@/server/security/crypto";
import { recordUsage } from "@/server/services/usage-service";

const MAX_SNIPPET_LENGTH = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ChatSearchOutcome {
  ok: boolean;
  taskId?: string;
  itemId?: string;
  resultCount: number;
  providerRequestId?: string;
  providerVersion?: string;
  providerMsg?: string;
  /** 供前端展示的用户可读错误 */
  errorCategory?: string;
  errorMessage?: string;
  partialParseErrors?: number;
}

async function buildYuanbaoProvider(workspaceId: string): Promise<SearchProvider> {
  const provider = await createProvider({ workspaceId, provider: "YUANBAO" });
  try {
    const credential = await prisma.searchProviderCredential.findUnique({ where: { workspaceId } });
    if (credential?.encryptedSecret && isEncryptionConfigured()) {
      registerSecret(decryptSecret(credential.encryptedSecret));
    }
  } catch {
    // 解密失败时 provider.search 会返回相应错误
  }
  return provider;
}

/**
 * 对话搜索执行器：复用元宝 Provider，真实调用 SearchPro，
 * 结果持久化为 SearchTask(source=CHAT) + SearchResult（questionId 为空，不进入 GEO 指标分母），
 * 同时生成 Evidence（brandId 可选）供证据库查看与追溯。
 */
export async function runChatSearch(params: {
  workspaceId: string;
  userId: string;
  conversationId: string;
  runId: string;
  query: string;
  brandId?: string | null;
  maxSources?: number;
  isCancelled?: () => boolean | Promise<boolean>;
}): Promise<ChatSearchOutcome> {
  const { workspaceId, userId, conversationId, runId, query } = params;
  const guard = await evaluateChatSearchGuard(workspaceId);
  if (!guard.ok) {
    return { ok: false, resultCount: 0, errorCategory: guard.code, errorMessage: guard.reason };
  }

  const brand = params.brandId
    ? await prisma.brand.findFirst({ where: { id: params.brandId, workspaceId } })
    : null;
  const competitors = brand
    ? await prisma.competitor.findMany({ where: { workspaceId, brandId: brand.id } })
    : [];

  const task = await prisma.searchTask.create({
    data: {
      workspaceId,
      brandId: brand?.id,
      name: `对话搜索：${query.slice(0, 40)}`,
      description: `对话 ${conversationId} 的运行 ${runId}`,
      provider: "YUANBAO",
      executionMode: "REAL",
      status: "RUNNING",
      source: "CHAT",
      totalItems: 1,
      params: { maxSources: params.maxSources ?? 8 } as never,
      startedAt: new Date(),
      createdById: userId,
    },
  });
  const item = await prisma.searchTaskItem.create({
    data: {
      taskId: task.id,
      workspaceId,
      questionText: query,
      status: "RUNNING",
    },
  });

  const provider = await buildYuanbaoProvider(workspaceId);
  const maxRetries = 2;
  const backoff = [1000, 3000];
  let attempts = 0;
  let response = await provider.search({
    query,
    requestId: `chat-${runId}#1`,
    metadata: { conversationId, runId },
  });
  attempts = 1;
  while (
    response.status === "failed" &&
    response.error?.retryable === true &&
    attempts <= maxRetries &&
    !((await params.isCancelled?.()) ?? false)
  ) {
    await sleep(backoff[Math.min(attempts - 1, backoff.length - 1)] ?? 3000);
    attempts += 1;
    response = await provider.search({
      query,
      requestId: `chat-${runId}#${attempts}`,
      metadata: { conversationId, runId },
    });
  }

  // 原始响应快照
  if (response.rawSnapshot) {
    await prisma.rawSearchResponse.create({
      data: {
        workspaceId,
        taskId: task.id,
        itemId: item.id,
        provider: "YUANBAO",
        requestId: response.providerRequestId,
        httpStatus: response.httpStatus,
        body: response.rawSnapshot,
        byteSize: response.rawSnapshot.length,
        truncated: response.rawSnapshotTruncated ?? false,
      },
    });
  }

  if (response.status === "failed") {
    await prisma.searchTaskItem.update({
      where: { id: item.id },
      data: {
        status: "FAILED",
        error: response.error?.userMessage ?? "搜索失败",
        errorCategory: response.error?.category ?? "UNKNOWN",
        providerRequestId: response.providerRequestId,
        durationMs: response.durationMs,
        httpStatus: response.httpStatus,
        attempts,
        executedAt: new Date(),
      },
    });
    await prisma.searchTask.update({
      where: { id: task.id },
      data: { status: "FAILED", failedItems: 1, finishedAt: new Date() },
    });
    return {
      ok: false,
      taskId: task.id,
      itemId: item.id,
      resultCount: 0,
      providerRequestId: response.providerRequestId,
      errorCategory: response.error?.category ?? "UNKNOWN",
      errorMessage: response.error?.userMessage ?? "搜索失败",
    };
  }

  const results = response.results;
  const parseNote = response.pageParseErrors?.length
    ? `${response.pageParseErrors.length} 条结果解析失败（已跳过）`
    : undefined;
  await prisma.searchTaskItem.update({
    where: { id: item.id },
    data: {
      status: "SUCCESS",
      error: parseNote,
      errorCategory: response.pageParseErrors?.length ? "PARTIAL_PARSE" : null,
      providerRequestId: response.providerRequestId,
      durationMs: response.durationMs,
      httpStatus: response.httpStatus,
      resultCount: results.length,
      attempts,
      executedAt: new Date(),
    },
  });
  await prisma.searchTask.update({
    where: { id: task.id },
    data: { status: "COMPLETED", successItems: 1, finishedAt: new Date() },
  });

  // 结果 + 证据（brandId 可选；无品牌上下文时仅做基础规则识别）
  for (const result of results) {
    const created = await prisma.searchResult.create({
      data: {
        workspaceId,
        taskId: task.id,
        itemId: item.id,
        questionId: null,
        position: result.position,
        title: (result.title || "(无标题)").slice(0, 500),
        url: result.url.slice(0, 2000),
        domain: result.domain,
        snippet: result.snippet ? result.snippet.slice(0, MAX_SNIPPET_LENGTH) : undefined,
        publishedAt: result.publishedAt,
        provider: "YUANBAO",
        isMock: false,
        extra: {
          siteName: result.siteName ?? null,
          score: result.score ?? null,
          authorityLevel: result.authorityLevel ?? null,
        } as never,
      },
    });
    const outcome = detectMention(
      brand ? { name: brand.name, aliases: brand.aliases, websiteDomain: brand.websiteDomain } : null,
      competitors.map((c) => ({ name: c.name, aliases: c.aliases, websiteDomain: c.websiteDomain })),
      {
        title: result.title,
        snippet: result.snippet ?? result.fullContent,
        url: result.url,
        domain: result.domain,
      }
    );
    await prisma.evidence.create({
      data: {
        workspaceId,
        brandId: brand?.id,
        taskId: task.id,
        questionId: null,
        resultId: created.id,
        title: created.title,
        url: created.url,
        domain: created.domain,
        snippet: created.snippet,
        publishedAt: result.publishedAt,
        collectedAt: new Date(response.searchedAt),
        provider: "YUANBAO",
        requestId: response.providerRequestId,
        isMock: false,
        mentionStatus: outcome.mentionStatus,
        detectionMethod: outcome.detectionMethod,
        matchedTerms: outcome.matchedTerms,
        competitorMatches: outcome.competitorMatches,
      },
    });
  }

  await recordUsage({
    workspaceId,
    kind: "SEARCH",
    refType: "CHAT_RUN",
    refId: runId,
    provider: "YUANBAO",
    costKnown: false,
    costNote: "搜索服务未返回计费数据",
  });

  return {
    ok: true,
    taskId: task.id,
    itemId: item.id,
    resultCount: results.length,
    providerRequestId: response.providerRequestId,
    providerVersion: response.providerVersion,
    providerMsg: response.providerMsg,
    partialParseErrors: response.pageParseErrors?.length,
  };
}

interface GuardResult {
  ok: boolean;
  code?: string;
  reason?: string;
}

/** 对话搜索守卫：与实验室任务同口径（凭据 CONNECTED + 全局开关 + 未禁用）。 */
export async function evaluateChatSearchGuard(workspaceId: string): Promise<GuardResult> {
  if (!env.yuanbaoSearchEnabled) {
    return { ok: false, code: "PROVIDER_DISABLED", reason: "元宝搜索数据源未启用（服务端 YUANBAO_SEARCH_ENABLED=false）。" };
  }
  const credential = await prisma.searchProviderCredential.findUnique({ where: { workspaceId } });
  if (!credential?.encryptedSecret) {
    return {
      ok: false,
      code: "PROVIDER_NOT_CONFIGURED",
      reason: "元宝搜索尚未配置 API Key：请先在「设置 → 数据源」完成配置。",
    };
  }
  if (credential.status === "DISABLED") {
    return { ok: false, code: "PROVIDER_DISABLED", reason: "数据源已被禁用，无法执行真实搜索。" };
  }
  if (credential.status !== "CONNECTED") {
    return {
      ok: false,
      code: "PROVIDER_NOT_CONNECTED",
      reason: "数据源尚未通过真实连接测试：请先在设置页执行「测试连接」。",
    };
  }
  return { ok: true };
}
