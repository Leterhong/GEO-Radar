import { randomUUID } from "crypto";
import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { createProvider } from "@/lib/providers/registry";
import type { SearchProvider } from "@/lib/providers/types";
import { analyzeEvidencePage, EVIDENCE_RULE_VERSION } from "./brand-matching";
import { ensureVersionForTask, enabledQuestionsFromVersion } from "./question-set-service";
import { createTaskSnapshot } from "./snapshot-service";
import { registerSecret } from "@/server/security/logger";
import { writeAuditLog } from "@/server/api/helpers";
import { recordUsage } from "@/server/services/usage-service";
import { CredentialEncryptionError, decryptSecret, isEncryptionConfigured } from "@/server/security/crypto";
import type { ExecutionMode, SearchTask, SearchTaskItem } from "@prisma/client";

const MAX_RETRIES = 2; // 可重试错误最多额外重试 2 次；每次尝试都单独计入 attempts
const RETRY_BACKOFF_MS = [1000, 3000];
const MAX_SNIPPET_LENGTH = 2000;

export interface CreateSearchTaskInput {
  name: string;
  description?: string;
  brandId?: string;
  questionSetId?: string;
  questionSetVersionId?: string;
  questionIds?: string[];
  /** ad hoc questions for agent search; not persisted as a QuestionSet */
  questions?: Array<{ id?: string; text: string; category?: string | null }>;
  provider: "YUANBAO" | "MOCK";
  executionMode: "REAL" | "MOCK";
  maxResults?: number;
  mode?: 0 | 1 | 2;
  industry?: "gov" | "news" | "acad" | "finance";
  freshness?: string;
  site?: string;
  deeplinks?: boolean;
  source?: string;
  scheduleId?: string;
  scheduleRunId?: string;
}

export class SearchExecutionError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export function searchExecutionErrorCode(error: unknown): string {
  return error instanceof SearchExecutionError ? error.code : "UNKNOWN";
}

export interface RealModeGuard {
  ok: boolean;
  reason?: string;
  code?: string;
}

/** 真实模式守卫：未配置 / 未通过连接测试 / 已禁用 / 全局未启用 时阻止真实搜索。 */
export function evaluateRealModeGuard(credential: {
  encryptedSecret: string | null;
  status: string;
} | null): RealModeGuard {
  if (!env.yuanbaoSearchEnabled) {
    return { ok: false, code: "PROVIDER_DISABLED", reason: "元宝搜索数据源未启用（服务端 YUANBAO_SEARCH_ENABLED=false）。" };
  }
  if (!credential?.encryptedSecret || !isEncryptionConfigured()) {
    return {
      ok: false,
      code: "PROVIDER_NOT_CONFIGURED",
      reason: "元宝搜索尚未配置 API Key，无法执行真实搜索。请先在“设置 → 数据源”完成配置并测试连接。",
    };
  }
  if (credential.status === "DISABLED") {
    return { ok: false, code: "PROVIDER_DISABLED", reason: "数据源已被禁用，无法执行新的真实搜索任务。" };
  }
  if (credential.status !== "CONNECTED") {
    return {
      ok: false,
      code: "PROVIDER_NOT_CONNECTED",
      reason: "数据源尚未通过真实连接测试：请先在设置页执行“测试连接”。",
    };
  }
  return { ok: true };
}

async function loadBrandContext(workspaceId: string, brandId?: string) {
  if (!brandId) return { brand: null, competitors: [] };
  const brand = await prisma.brand.findFirst({ where: { id: brandId, workspaceId } });
  if (!brand) throw new SearchExecutionError("BRAND_NOT_FOUND", "品牌不存在或不属于当前工作空间");
  const competitors = await prisma.competitor.findMany({ where: { workspaceId, brandId, enabled: true } });
  return { brand, competitors };
}

/** 创建任务（QUEUED）：校验配置与问题；创建任务不发起任何真实请求。 */
export async function createSearchTask(
  workspaceId: string,
  userId: string,
  input: CreateSearchTaskInput
) {
  if (input.executionMode === "REAL") {
    if (input.provider !== "YUANBAO") {
      throw new SearchExecutionError("INVALID_MODE", "真实模式只能使用元宝搜索数据源");
    }
    if (input.maxResults !== undefined && ![10, 20, 30, 40, 50].includes(input.maxResults)) {
      throw new SearchExecutionError("INVALID_MAX_RESULTS", "元宝搜索返回条数 Cnt 仅支持 10/20/30/40/50。");
    }
    const credential = await prisma.searchProviderCredential.findUnique({ where: { workspaceId } });
    const guard = evaluateRealModeGuard(credential);
    if (!guard.ok) throw new SearchExecutionError(guard.code ?? "PROVIDER_UNAVAILABLE", guard.reason ?? "数据源不可用");
  } else if (input.provider !== "MOCK") {
    throw new SearchExecutionError("INVALID_MODE", "模拟模式只能使用 MOCK 数据源");
  }

  const { brand, competitors } = await loadBrandContext(workspaceId, input.brandId);

  let questions: Array<{ id?: string; text: string; category: string | null }> = [];
  let questionSetId: string | undefined;
  let questionSetVersionId: string | undefined;
  let questionSetVersion: number | undefined;

  if (input.questions && input.questions.length > 0) {
    questions = input.questions
      .map((q) => ({ id: q.id, text: q.text.trim(), category: q.category ?? null }))
      .filter((q) => q.text !== "");
  } else if (input.questionIds && input.questionIds.length > 0) {
    const rows = await prisma.question.findMany({
      where: { workspaceId, id: { in: input.questionIds }, enabled: true },
      select: { id: true, text: true, category: true, questionSetId: true },
      orderBy: { createdAt: "asc" },
    });
    questions = rows;
    const setIds = new Set(rows.map((r) => r.questionSetId));
    if (setIds.size === 1) {
      questionSetId = rows[0]?.questionSetId;
      if (questionSetId) {
        const version = await ensureVersionForTask(workspaceId, questionSetId, userId);
        questionSetVersionId = version.id;
        questionSetVersion = version.version;
      }
    }
  } else if (input.questionSetId) {
    const set = await prisma.questionSet.findFirst({
      where: { id: input.questionSetId, workspaceId, archivedAt: null },
    });
    if (!set) throw new SearchExecutionError("QUESTION_SET_NOT_FOUND", "问题集不存在、已归档或不属于当前工作空间");
    // 冻结问题集版本：指定版本（定时/复测）优先，否则使用当前版本
    const version = input.questionSetVersionId
      ? await prisma.questionSetVersion.findFirst({
          where: { id: input.questionSetVersionId, questionSetId: set.id, workspaceId },
        })
      : await ensureVersionForTask(workspaceId, set.id, userId);
    if (!version) throw new SearchExecutionError("VERSION_NOT_FOUND", "指定的问题集版本不存在或不属于该问题集");
    questionSetId = set.id;
    questionSetVersionId = version.id;
    questionSetVersion = version.version;
    questions = enabledQuestionsFromVersion(version).map((q) => ({
      id: q.id,
      text: q.text,
      category: q.category,
    }));
  }
  if (questions.length === 0) {
    throw new SearchExecutionError("NO_QUESTIONS", "没有可执行的问题：请选择包含启用状态问题的集合");
  }
  if (questions.length > env.maxQuestionsPerTask) {
    throw new SearchExecutionError("TOO_MANY_QUESTIONS", `单次任务最多支持 ${env.maxQuestionsPerTask} 个问题`);
  }

  const brandSnapshot = {
    capturedAt: new Date().toISOString(),
    ruleVersion: EVIDENCE_RULE_VERSION,
    brand: brand
      ? {
          id: brand.id,
          name: brand.name,
          englishName: brand.englishName,
          aliases: brand.aliases,
          websiteDomain: brand.websiteDomain,
          officialSubdomains: brand.officialSubdomains,
          products: brand.products,
          productAliases: brand.productAliases,
        }
      : null,
    competitors: competitors.map((c) => ({
      id: c.id,
      name: c.name,
      aliases: c.aliases,
      websiteDomain: c.websiteDomain,
    })),
  };

  // 防重复提交：60 秒内同名 / 同品牌 / 同问题集版本 / 同模式的排队或执行中任务
  const duplicate = await prisma.searchTask.findFirst({
    where: {
      workspaceId,
      name: input.name,
      executionMode: input.executionMode,
      brandId: brand?.id ?? null,
      questionSetVersionId: questionSetVersionId ?? null,
      status: { in: ["QUEUED", "RUNNING"] },
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new SearchExecutionError(
      "DUPLICATE_TASK",
      `检测到 60 秒内已提交相同任务（${duplicate.id}），请勿重复提交；如确需新一轮采集，请更换任务名称或等待当前任务结束。`
    );
  }

  const task = await prisma.searchTask.create({
    data: {
      workspaceId,
      brandId: brand?.id,
      name: input.name,
      description: input.description,
      provider: input.provider,
      executionMode: input.executionMode,
      status: "QUEUED",
      source: input.source ?? "LAB",
      scheduleId: input.scheduleId,
      scheduleRunId: input.scheduleRunId,
      questionSetId,
      questionSetVersionId,
      questionSetVersion,
      totalItems: questions.length,
      params: {
        maxResults: input.maxResults,
        mode: input.mode,
        industry: input.industry,
        freshness: input.freshness,
        site: input.site,
        deeplinks: input.deeplinks,
        selectedQuestionIds: input.questionIds ?? undefined,
      } as never,
      brandSnapshot: brandSnapshot as never,
      createdById: userId,
      items: {
        create: questions.map((q) => ({
          workspaceId,
          questionId: q.id,
          questionText: q.text,
          categorySnapshot: q.category,
        })),
      },
    },
  });
  await writeAuditLog({
    workspaceId,
    userId,
    action: "SEARCH_TASK_CREATED",
    targetType: "SearchTask",
    targetId: task.id,
    metadata: { provider: input.provider, executionMode: input.executionMode, totalItems: questions.length },
  });
  return task;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 启动执行（必须由用户主动确认后调用；页面加载、切换标签、刷新大屏绝不调用本函数）。
 * 执行在当前进程内进行，逐项持久化进度；前端轮询任务状态查看进度。
 * 生产多实例部署时，应将执行器迁移到独立后台工作进程（见 docs/architecture.md）。
 */
export async function startSearchTask(taskId: string, workspaceId: string, userId: string) {
  const task = await prisma.searchTask.findFirst({ where: { id: taskId, workspaceId } });
  if (!task) throw new SearchExecutionError("TASK_NOT_FOUND", "任务不存在或不属于当前工作空间");
  if (task.status !== "QUEUED") {
    throw new SearchExecutionError("INVALID_TASK_STATE", `任务当前状态为 ${task.status}，无法重复启动`);
  }
  if (task.executionMode === "REAL") {
    const credential = await prisma.searchProviderCredential.findUnique({ where: { workspaceId } });
    const guard = evaluateRealModeGuard(credential);
    if (!guard.ok) {
      await prisma.searchTaskItem.updateMany({
        where: { taskId, status: "PENDING" },
        data: {
          status: "FAILED",
          error: guard.reason ?? "数据源不可用",
          errorCategory: guard.code ?? "PROVIDER_UNAVAILABLE",
        },
      });
      await prisma.searchTask.update({
        where: { id: taskId },
        data: {
          status: "FAILED",
          failedItems: task.totalItems,
          failureReason: guard.reason ?? "数据源不可用",
          finishedAt: new Date(),
        },
      });
      throw new SearchExecutionError(guard.code ?? "PROVIDER_UNAVAILABLE", `${guard.reason} 任务已标记失败。`);
    }
  }
  await prisma.searchTask.update({
    where: { id: taskId },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  await writeAuditLog({ workspaceId, userId, action: "SEARCH_TASK_STARTED", targetType: "SearchTask", targetId: taskId });
  return runTaskExecutionSafely(task, workspaceId, userId);
}

/** 重试失败项（用户主动触发，遵守真实模式守卫）。 */
export async function retryFailedItems(taskId: string, workspaceId: string, userId: string) {
  const task = await prisma.searchTask.findFirst({ where: { id: taskId, workspaceId } });
  if (!task) throw new SearchExecutionError("TASK_NOT_FOUND", "任务不存在或不属于当前工作空间");
  if (task.status === "RUNNING") {
    throw new SearchExecutionError("INVALID_TASK_STATE", "任务正在执行中，无法重试");
  }
  const failedCount = await prisma.searchTaskItem.count({ where: { taskId, status: "FAILED" } });
  if (failedCount === 0) throw new SearchExecutionError("NOTHING_TO_RETRY", "没有失败的问题可以重试");
  if (task.executionMode === "REAL") {
    const credential = await prisma.searchProviderCredential.findUnique({ where: { workspaceId } });
    const guard = evaluateRealModeGuard(credential);
    if (!guard.ok) throw new SearchExecutionError(guard.code ?? "PROVIDER_UNAVAILABLE", guard.reason ?? "数据源不可用");
  }
  await prisma.searchTaskItem.updateMany({
    where: { taskId, status: "FAILED" },
    data: { status: "PENDING", error: null, errorCategory: null },
  });
  await prisma.searchTask.update({
    where: { id: taskId },
    data: { status: "RUNNING", failedItems: 0, finishedAt: null },
  });
  await writeAuditLog({
    workspaceId,
    userId,
    action: "SEARCH_TASK_RETRY",
    targetType: "SearchTask",
    targetId: taskId,
    metadata: { retriedItems: failedCount },
  });
  return runTaskExecutionSafely(task, workspaceId, userId, `retry-${Date.now()}`);
}

/**
 * 执行器安全包装：
 * 任何未预期异常（Provider 构建/解密失败、数据库异常等）都必须把任务从 RUNNING 收敛为
 * FAILED/PARTIAL_FAILED，避免任务永远停留在执行中。已成功的结果保留。
 */
async function runTaskExecutionSafely(
  task: SearchTask,
  workspaceId: string,
  userId: string,
  snapshotTag?: string
) {
  try {
    return await runTaskExecution(task, workspaceId, userId, snapshotTag);
  } catch (error) {
    await prisma.searchTaskItem.updateMany({
      where: { taskId: task.id, status: { in: ["PENDING", "RUNNING"] } },
      data: {
        status: "FAILED",
        error: "执行器异常，未完成",
        errorCategory: "EXECUTOR_ERROR",
      },
    });
    const [success, failed] = await Promise.all([
      prisma.searchTaskItem.count({ where: { taskId: task.id, status: "SUCCESS" } }),
      prisma.searchTaskItem.count({ where: { taskId: task.id, status: "FAILED" } }),
    ]);
    await prisma.searchTask.updateMany({
      where: { id: task.id, status: "RUNNING" },
      data: {
        status: success > 0 ? "PARTIAL_FAILED" : "FAILED",
        successItems: success,
        failedItems: failed,
        failureReason: `执行器异常：${error instanceof Error ? error.message.slice(0, 300) : "未知错误"}`,
        finishedAt: new Date(),
      },
    });
    await writeAuditLog({
      workspaceId,
      userId,
      action: "SEARCH_TASK_EXECUTOR_ERROR",
      targetType: "SearchTask",
      targetId: task.id,
      metadata: { message: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}

/** 执行主体：从 PENDING 项开始，以受限并发逐项执行并持久化进度。 */
async function runTaskExecution(task: SearchTask, workspaceId: string, userId: string, snapshotTag?: string) {
  const taskId = task.id;
  const provider = await buildProvider(workspaceId, task.provider);
  const params = (task.params ?? {}) as {
    maxResults?: number;
    mode?: 0 | 1 | 2;
    industry?: "gov" | "news" | "acad" | "finance";
    freshness?: string;
    site?: string;
    deeplinks?: boolean;
  };
  const { brand, competitors } = await loadBrandContext(workspaceId, task.brandId ?? undefined);

  let cancelled = false;
  let timedOut = false;
  const deadline = Date.now() + env.taskTimeoutMs;
  const queue: SearchTaskItem[] = await prisma.searchTaskItem.findMany({
    where: { taskId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });

  async function worker() {
    while (queue.length > 0 && !cancelled && !timedOut) {
      if (Date.now() > deadline) {
        timedOut = true;
        return;
      }
      const fresh = await prisma.searchTask.findUnique({
        where: { id: taskId },
        select: { cancelRequested: true, status: true },
      });
      if (!fresh || fresh.cancelRequested || fresh.status !== "RUNNING") {
        cancelled = true;
        return;
      }
      const next = queue.shift();
      if (!next) return;
      const { response, attempts } = await executeItemWithRetry(provider, task.executionMode, {
        query: next.questionText,
        maxResults: params.maxResults,
        mode: params.mode,
        industry: params.industry,
        freshness: params.freshness,
        site: params.site,
        deeplinks: params.deeplinks,
      });
      await persistItemResult({
        task,
        item: next,
        workspaceId,
        attempts,
        response,
        brand: brand
          ? {
              name: brand.name,
              englishName: brand.englishName,
              aliases: brand.aliases,
              websiteDomain: brand.websiteDomain,
              officialSubdomains: brand.officialSubdomains,
              products: brand.products,
              productAliases: brand.productAliases,
            }
          : null,
        competitors: competitors.map((c) => ({
          name: c.name,
          aliases: c.aliases,
          websiteDomain: c.websiteDomain,
        })),
      });
    }
  }

  const concurrency = env.searchConcurrency;
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  if (cancelled) {
    await prisma.searchTaskItem.updateMany({
      where: { taskId, status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "CANCELLED" },
    });
  }
  if (timedOut) {
    await prisma.searchTaskItem.updateMany({
      where: { taskId, status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "CANCELLED", error: "任务执行超时，未执行", errorCategory: "TASK_TIMEOUT" },
    });
  }
  const [success, failed, empty, parseErrors, firstFailure] = await Promise.all([
    prisma.searchTaskItem.count({ where: { taskId, status: "SUCCESS" } }),
    prisma.searchTaskItem.count({ where: { taskId, status: "FAILED" } }),
    prisma.searchTaskItem.count({ where: { taskId, status: "SUCCESS", resultCount: 0 } }),
    prisma.searchTaskItem.count({
      where: { taskId, OR: [{ parseErrorCount: { gt: 0 } }, { errorCategory: "PARTIAL_PARSE" }] },
    }),
    prisma.searchTaskItem.findFirst({
      where: { taskId, status: "FAILED" },
      select: { error: true, errorCategory: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  let finalStatus: "COMPLETED" | "PARTIAL_FAILED" | "FAILED" | "CANCELLED";
  if (cancelled) finalStatus = "CANCELLED";
  else if (timedOut) finalStatus = success > 0 ? "PARTIAL_FAILED" : "FAILED";
  else if (failed === 0) finalStatus = "COMPLETED";
  else if (success > 0) finalStatus = "PARTIAL_FAILED";
  else finalStatus = "FAILED";
  const failureReason =
    finalStatus === "CANCELLED"
      ? "用户取消任务"
      : timedOut
        ? `任务执行超时（上限 ${Math.round(env.taskTimeoutMs / 1000)} 秒），已停止派发新问题；已完成的结果保留。`
        : finalStatus === "FAILED"
          ? firstFailure
            ? `${firstFailure.errorCategory ?? "UNKNOWN"}：${firstFailure.error ?? "全部问题执行失败"}`
            : "全部问题执行失败"
          : null;
  await prisma.searchTask.update({
    where: { id: taskId },
    data: {
      status: finalStatus,
      successItems: success,
      failedItems: failed,
      emptyItems: empty,
      parseErrorItems: parseErrors,
      failureReason,
      cancelRequested: false,
      finishedAt: new Date(),
    },
  });
  await writeAuditLog({
    workspaceId,
    userId,
    action: "SEARCH_TASK_FINISHED",
    targetType: "SearchTask",
    targetId: taskId,
    metadata: { status: finalStatus, success, failed, empty, parseErrors },
  });

  // 采集完成即保存不可变分析快照（失败不影响任务结果）
  // 重试即使全部失败也保存一个带版本标记的快照，使后续比较看到真实的重试结果。
  if (success > 0 || snapshotTag) {
    try {
      await createTaskSnapshot(workspaceId, taskId, {
        kind: "COLLECTION",
        createdById: userId,
        ruleVersionTag: snapshotTag,
      });
    } catch (error) {
      console.error("[snapshot] 创建采集快照失败:", error instanceof Error ? error.message : error);
    }
  }
  return prisma.searchTask.findUnique({ where: { id: taskId } });
}

async function buildProvider(workspaceId: string, providerName: "YUANBAO" | "MOCK"): Promise<SearchProvider> {
  const provider = await createProvider({ workspaceId, provider: providerName });
  if (providerName === "YUANBAO") {
    try {
      const credential = await prisma.searchProviderCredential.findUnique({ where: { workspaceId } });
      if (credential?.encryptedSecret && isEncryptionConfigured()) {
        registerSecret(decryptSecret(credential.encryptedSecret));
      }
    } catch {
      // 解密失败时 provider.search 会返回相应错误
    }
  }
  return provider;
}

interface ExecuteItemArgs {
  query: string;
  maxResults?: number;
  mode?: 0 | 1 | 2;
  industry?: "gov" | "news" | "acad" | "finance";
  freshness?: string;
  site?: string;
  deeplinks?: boolean;
}

/** 单项执行 + 有上限退避重试（每次尝试计入 attempts；认证/参数错误绝不重试）。 */
async function executeItemWithRetry(
  provider: SearchProvider,
  executionMode: ExecutionMode,
  args: ExecuteItemArgs
) {
  const requestId = randomUUID();
  let attempts = 0;
  let last = await provider.search({
    query: args.query,
    maxResults: args.maxResults,
    mode: args.mode,
    site: args.site,
    industry: args.industry,
    freshness: args.freshness,
    deeplinks: args.deeplinks,
    requestId: `${requestId}#1`,
    metadata: { executionMode },
  });
  attempts += 1;
  while (last.status === "failed" && last.error?.retryable === true && attempts <= MAX_RETRIES) {
    await sleep(RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)] ?? 3000);
    attempts += 1;
    last = await provider.search({
      query: args.query,
      maxResults: args.maxResults,
      mode: args.mode,
      site: args.site,
      industry: args.industry,
      freshness: args.freshness,
      deeplinks: args.deeplinks,
      requestId: `${requestId}#${attempts}`,
      metadata: { executionMode },
    });
  }
  return { response: last, attempts };
}

interface PersistArgs {
  task: SearchTask;
  item: SearchTaskItem;
  workspaceId: string;
  attempts: number;
  response: Awaited<ReturnType<SearchProvider["search"]>>;
  brand: {
    name: string;
    englishName: string | null;
    aliases: string[];
    websiteDomain: string | null;
    officialSubdomains: string[];
    products: string[];
    productAliases: string[];
  } | null;
  competitors: Array<{ name: string; aliases: string[]; websiteDomain: string | null }>;
}

async function persistItemResult(args: PersistArgs): Promise<void> {
  const { task, item, workspaceId, response, attempts } = args;
  const isMock = task.executionMode === "MOCK";

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
    return;
  }

  // 原始响应快照（真实模式）用于追溯与重新解析；设大小上限与保留策略
  let rawResponseId: string | undefined;
  if (response.rawSnapshot && !isMock) {
    const raw = await prisma.rawSearchResponse.create({
      data: {
        workspaceId,
        taskId: task.id,
        itemId: item.id,
        provider: task.provider,
        requestId: response.providerRequestId,
        httpStatus: response.httpStatus,
        body: response.rawSnapshot,
        requestMeta: {
          query: response.query,
          params: (task.params ?? null) as never,
          executionMode: task.executionMode,
          providerVersion: response.providerVersion ?? null,
          providerMsg: response.providerMsg ?? null,
          searchedAt: response.searchedAt,
          durationMs: response.durationMs ?? null,
          pageParseErrorCount: response.pageParseErrors?.length ?? 0,
          requestId: response.requestId,
        } as never,
        byteSize: response.rawSnapshot.length,
        truncated: response.rawSnapshotTruncated ?? false,
      },
    });
    rawResponseId = raw.id;
  }

  const results = response.results;
  const parseNote = parseErrorNote(response);
  if (!isMock) {
    void recordUsage({
      workspaceId,
      kind: "SEARCH",
      refType: "LAB_TASK_ITEM",
      refId: item.id,
      provider: task.provider,
      costKnown: false,
      costNote: "搜索服务未返回计费数据",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.searchTaskItem.update({
      where: { id: item.id },
      data: {
        status: "SUCCESS",
        error: parseNote,
        errorCategory: response.pageParseErrors && response.pageParseErrors.length > 0 ? "PARTIAL_PARSE" : null,
        providerRequestId: response.providerRequestId,
        durationMs: response.durationMs,
        httpStatus: response.httpStatus,
        resultCount: results.length,
        parseErrorCount: response.pageParseErrors?.length ?? 0,
        attempts,
        executedAt: new Date(),
      },
    });
    for (const result of results) {
      const created = await tx.searchResult.create({
        data: {
          workspaceId,
          taskId: task.id,
          itemId: item.id,
          questionId: item.questionId,
          position: result.position,
          title: (result.title || "(无标题)").slice(0, 500),
          url: result.url.slice(0, 2000),
          domain: result.domain,
          snippet: result.snippet ? result.snippet.slice(0, MAX_SNIPPET_LENGTH) : undefined,
          publishedAt: result.publishedAt,
          provider: task.provider,
          isMock,
          extra: {
            fullContent: result.fullContent ?? null,
            siteName: result.siteName ?? null,
            score: result.score ?? null,
            authorityLevel: result.authorityLevel ?? null,
            pics: result.pics ?? null,
            favicon: result.favicon ?? null,
            deeplinks: result.deeplinks ?? null,
          } as never,
        },
      });
      const analysis = analyzeEvidencePage(
        {
          url: result.url,
          title: result.title,
          snippet: result.snippet,
          fullContent: result.fullContent,
          domain: result.domain,
          siteName: result.siteName,
          publishedAt: result.publishedAt,
        },
        args.brand,
        args.competitors
      );
      await tx.evidence.create({
        data: {
          workspaceId,
          brandId: task.brandId ?? undefined,
          taskId: task.id,
          questionId: item.questionId,
          resultId: created.id,
          rawResponseId,
          title: created.title,
          url: created.url,
          normalizedUrl: analysis.normalizedUrl,
          domain: created.domain,
          snippet: created.snippet,
          publishedAt: result.publishedAt,
          collectedAt: new Date(response.searchedAt),
          provider: task.provider,
          requestId: response.providerRequestId,
          isMock,
          pageType: analysis.pageType,
          pageTypeSource: "RULE",
          pageTypeRule: analysis.pageTypeRule,
          sourceRole: analysis.sourceRole,
          mentionStatus: analysis.mentionStatus,
          detectionMethod: analysis.detectionMethod,
          brandMatchBasis: analysis.brandMatchBasis,
          matchedTerms: analysis.matchedTerms,
          competitorMatches: analysis.competitorMatches,
          officialDomainMatch: analysis.officialDomainMatch,
          thirdPartyMention: analysis.thirdPartyMention,
          ruleVersion: analysis.ruleVersion,
          analyzedAt: new Date(),
          relevance: analysis.relevance,
        },
      });
    }
  });
}

function parseErrorNote(response: { pageParseErrors?: Array<{ index: number; reason: string }> }): string | undefined {
  const errors = response.pageParseErrors;
  if (!errors || errors.length === 0) return undefined;
  const sample = errors[0];
  if (!sample) return undefined;
  return `${errors.length} 条结果解析失败（已跳过，其余结果正常保存）；示例：第 ${sample.index + 1} 条 ${sample.reason}`;
}

/** 用户主动取消任务。 */
export async function cancelSearchTask(taskId: string, workspaceId: string, userId: string) {
  const task = await prisma.searchTask.findFirst({ where: { id: taskId, workspaceId } });
  if (!task) throw new SearchExecutionError("TASK_NOT_FOUND", "任务不存在或不属于当前工作空间");
  if (task.status === "QUEUED") {
    await prisma.searchTaskItem.updateMany({ where: { taskId, status: "PENDING" }, data: { status: "CANCELLED" } });
    const [success, failed, empty, parseErrors] = await Promise.all([
      prisma.searchTaskItem.count({ where: { taskId, status: "SUCCESS" } }),
      prisma.searchTaskItem.count({ where: { taskId, status: "FAILED" } }),
      prisma.searchTaskItem.count({ where: { taskId, status: "SUCCESS", resultCount: 0 } }),
      prisma.searchTaskItem.count({ where: { taskId, parseErrorCount: { gt: 0 } } }),
    ]);
    await prisma.searchTask.update({
      where: { id: taskId },
      data: {
        status: "CANCELLED",
        cancelRequested: false,
        successItems: success,
        failedItems: failed,
        emptyItems: empty,
        parseErrorItems: parseErrors,
        failureReason: "用户取消任务（尚未执行）",
        finishedAt: new Date(),
      },
    });
  } else if (task.status === "RUNNING") {
    await prisma.searchTask.update({ where: { id: taskId }, data: { cancelRequested: true } });
  } else {
    throw new SearchExecutionError("INVALID_TASK_STATE", `任务当前状态为 ${task.status}，无法取消`);
  }
  await writeAuditLog({
    workspaceId,
    userId,
    action: "SEARCH_TASK_CANCEL_REQUESTED",
    targetType: "SearchTask",
    targetId: taskId,
  });
}

export { CredentialEncryptionError };
