import { prisma } from "@/server/db/client";
import { createModelAdapter } from "@/lib/model-providers/registry";
import { ModelError } from "@/lib/model-providers/types";
import type { ChatMessage } from "@/lib/model-providers/types";
import { evaluateChatSearchGuard, runChatSearch } from "./search-runner";
import { buildSearchContext, trimHistory, validateCitations } from "./context-builder";
import { computeOverviewMetrics, computeSourceDomains, computeCompetitorMetrics } from "@/server/services/metrics";
import { getModelCredentialForStatus } from "@/lib/model-providers/registry";
import { writeAuditLog } from "@/server/api/helpers";
import { recordUsage } from "@/server/services/usage-service";
import { registerSecret } from "@/server/security/logger";
import { decryptSecret, isEncryptionConfigured } from "@/server/security/crypto";
import type { Conversation, ConversationRun } from "@prisma/client";

export type ConversationModeValue = "SEARCH_ANSWER" | "SEARCH_EVIDENCE" | "GEO_ANALYSIS";

export class ConversationError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

const MAX_QUERY_LENGTH = 500;

export interface StartRunInput {
  mode: ConversationModeValue;
  content: string;
  brandId?: string | null;
  /** 用户明确选择「仅查看搜索结果」（无模型时的知情降级） */
  searchOnly?: boolean;
}

/** 创建用户消息 + Run（QUEUED），异步执行；立即返回 runId。 */
export async function startRun(
  conversationId: string,
  workspaceId: string,
  userId: string,
  input: StartRunInput
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
  });
  if (!conversation) throw new ConversationError("CONVERSATION_NOT_FOUND", "会话不存在或不属于当前工作空间");

  const content = input.content.trim();
  if (content === "") throw new ConversationError("EMPTY_MESSAGE", "消息内容不能为空");
  if (content.length > MAX_QUERY_LENGTH) {
    throw new ConversationError("MESSAGE_TOO_LONG", `消息过长（最多 ${MAX_QUERY_LENGTH} 字符）`);
  }

  // 搜索类模式的前置检查：在创建任何记录前给出明确提示（不假装执行）
  if (input.mode === "SEARCH_ANSWER" || input.mode === "SEARCH_EVIDENCE") {
    const guard = await evaluateChatSearchGuard(workspaceId);
    if (!guard.ok) throw new ConversationError(guard.code ?? "PROVIDER_UNAVAILABLE", guard.reason ?? "搜索数据源不可用");
  }

  // 自动命名：第一条用户消息生成简单本地标题，不触发模型调用
  let title = conversation.title;
  if (title === "新对话") {
    const messageCount = await prisma.conversationMessage.count({ where: { conversationId } });
    if (messageCount === 0) {
      title = content.slice(0, 24) + (content.length > 24 ? "…" : "");
    }
  }
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { title, currentMode: input.mode },
  });

  const userMessage = await prisma.conversationMessage.create({
    data: {
      conversationId,
      role: "USER",
      content,
      mode: input.mode,
      status: "COMPLETED",
    },
  });
  const run = await prisma.conversationRun.create({
    data: {
      conversationId,
      userMessageId: userMessage.id,
      mode: input.mode,
      status: "QUEUED",
      stage: "queued",
      brandId: input.brandId || null,
    },
  });
  await writeAuditLog({
    workspaceId,
    userId,
    action: "CONVERSATION_RUN_STARTED",
    targetType: "ConversationRun",
    targetId: run.id,
    metadata: { mode: input.mode, searchOnly: input.searchOnly === true },
  });
  void executeRun(run.id).catch((error) => {
    console.error("[conversation] run 执行异常:", error instanceof Error ? error.message : error);
  });
  return { runId: run.id, userMessageId: userMessage.id, title };
}

async function isRunCancelled(runId: string): Promise<boolean> {
  const run = await prisma.conversationRun.findUnique({ where: { id: runId }, select: { cancelRequested: true } });
  return run?.cancelRequested ?? false;
}

async function markRun(runId: string, data: Partial<{ status: "QUEUED" | "SEARCHING" | "GENERATING" | "COMPLETED" | "FAILED" | "CANCELLED"; stage: string | null; errorCode: string | null; finishedAt: Date | null }>) {
  await prisma.conversationRun.update({ where: { id: runId }, data: data as never });
}

/** 执行主体：按模式分派。真实阶段状态（stage）实时落库，前端轮询展示。 */
export async function executeRun(runId: string): Promise<void> {
  const run = await prisma.conversationRun.findUnique({
    where: { id: runId },
    include: { conversation: true },
  });
  if (!run) return;
  const workspaceId = run.conversation.workspaceId;
  const userId = run.conversation.userId;
  try {
    if (run.mode === "SEARCH_ANSWER") await executeSearchAnswer(run, workspaceId, userId);
    else if (run.mode === "SEARCH_EVIDENCE") await executeSearchEvidence(run, workspaceId, userId);
    else await executeGeoAnalysis(run, workspaceId, userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markRun(runId, { status: "FAILED", errorCode: "INTERNAL_ERROR", stage: "failed", finishedAt: new Date() });
    const userMessage = await prisma.conversationMessage.findUnique({ where: { id: run.userMessageId } });
    await prisma.conversationMessage.create({
      data: {
        conversationId: run.conversationId,
        role: "SYSTEM",
        content: message.slice(0, 500),
        mode: run.mode,
        status: "FAILED",
        errorCode: "INTERNAL_ERROR",
        runId: run.id,
      },
    });
    void userMessage;
    console.error("[conversation] 执行失败:", message);
  }
}

async function getRunSourcesContext(run: ConversationRun, maxSources: number) {
  if (!run.searchTaskId) return { sources: [], contextText: "（本次搜索没有返回可用来源）" };
  const results = await prisma.searchResult.findMany({
    where: { taskId: run.searchTaskId },
    orderBy: { position: "asc" },
  });
  return buildSearchContext(results, { maxSources });
}

async function loadModelAdapter(workspaceId: string, runId: string, conversationId: string) {
  const credential = await getModelCredentialForStatus(workspaceId);
  if (!credential?.encryptedSecret || credential.status === "DISABLED") return null;
  try {
    const adapter = await createModelAdapter(workspaceId);
    try {
      const cred = await prisma.modelProviderCredential.findUnique({ where: { workspaceId } });
      if (cred?.encryptedSecret && isEncryptionConfigured()) {
        registerSecret(decryptSecret(cred.encryptedSecret));
      }
    } catch {
      // 脱敏失败不影响调用
    }
    await prisma.conversationRun.update({
      where: { id: runId },
      data: {
        modelProvider: adapter.info.provider,
        modelName: adapter.info.model,
      },
    });
    void conversationId;
    return adapter;
  } catch (error) {
    if (error instanceof ModelError) throw error;
    return null;
  }
}

/** 会话附件文本（服务端已提取），限制条数与总长度，作为可核查的补充材料。 */
async function loadAttachmentContext(conversationId: string): Promise<string | null> {
  const attachments = await prisma.conversationAttachment.findMany({
    where: { conversationId, parseStatus: "PARSED", extractedText: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { filename: true, extractedText: true },
  });
  if (attachments.length === 0) return null;
  const blocks: string[] = [];
  let budget = 6000;
  for (const file of attachments) {
    if (budget <= 0) break;
    const text = (file.extractedText ?? "").slice(0, Math.min(4000, budget));
    if (text.trim() === "") continue;
    blocks.push(`【附件：${file.filename}】\n${text}`);
    budget -= text.length;
  }
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

/** 历史上下文：仅当前会话、user/assistant、按时间正序，限制长度。 */
async function loadHistory(conversationId: string, excludeMessageId: string): Promise<ChatMessage[]> {
  const messages = await prisma.conversationMessage.findMany({
    where: { conversationId, role: { in: ["USER", "ASSISTANT"] }, id: { not: excludeMessageId } },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
    take: 40,
  });
  return trimHistory(
    messages.map((m) => ({ role: m.role === "USER" ? ("user" as const) : ("assistant" as const), content: m.content }))
  );
}

// ── 模式 A：搜索问答 ─────────────────────────────────────────
async function executeSearchAnswer(run: ConversationRun, workspaceId: string, userId: string): Promise<void> {
  const userMessage = await prisma.conversationMessage.findUniqueOrThrow({ where: { id: run.userMessageId } });
  await markRun(run.id, { status: "SEARCHING", stage: "searching" });

  const search = await runChatSearch({
    workspaceId,
    userId,
    conversationId: run.conversationId,
    runId: run.id,
    query: userMessage.content,
    brandId: run.brandId,
    isCancelled: () => isRunCancelled(run.id),
  });
  if (!search.ok) {
    // 搜索失败：不生成任何回答，保留错误与重试入口
    await prisma.conversationRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        stage: "search_failed",
        searchTaskId: search.taskId,
        searchItemId: search.itemId,
        searchError: `[${search.errorCategory}] ${search.errorMessage ?? "搜索失败"}`,
        errorCode: search.errorCategory ?? "SEARCH_FAILED",
        finishedAt: new Date(),
      },
    });
    return;
  }
  await prisma.conversationRun.update({
    where: { id: run.id },
    data: { searchTaskId: search.taskId, searchItemId: search.itemId },
  });
  if (await isRunCancelled(run.id)) {
    await markCancelled(run.id);
    return;
  }

  const { sources, contextText } = await getRunSourcesContext(run, 8);

  // 模型未配置：不伪造回答。若用户知情选择「仅查看搜索结果」，展示真实结果摘要。
  const adapter = await loadModelAdapter(workspaceId, run.id, run.conversationId);
  if (!adapter) {
    const sourceList = sources
      .map((s) => `${s.index}. ${s.title} — ${s.domain ?? s.url}`)
      .join("\n");
    const content = sources.length
      ? `已获取 **${sources.length} 条真实搜索结果**（RequestId：${search.providerRequestId ?? "—"}）。未配置大模型，无法生成综合回答；以下是本次搜索的来源列表：\n\n${sourceList}\n\n你可以在「设置 → 大模型」配置模型后重新生成回答，或切换到「搜索证据」模式查看完整结果。`
      : `搜索完成但没有返回结果（RequestId：${search.providerRequestId ?? "—"}）。未配置大模型，无法做进一步分析。请尝试调整问题关键词后重新提问。`;
    await saveAssistantMessage(run, content, sources.map((s) => s.searchResultId), "COMPLETED");
    await prisma.conversationRun.update({
      where: { id: run.id },
      data: { status: "COMPLETED", stage: "completed_no_model", finishedAt: new Date() },
    });
    return;
  }

  await markRun(run.id, { status: "GENERATING", stage: "generating" });
  const history = await loadHistory(run.conversationId, run.userMessageId);
  const systemPrompt = buildSearchAnswerSystemPrompt();
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history,
    {
      role: "user",
      content: `我的问题：${userMessage.content}\n\n以下是本次搜索返回的带编号来源（引用时使用 [编号]）：\n\n${contextText}`,
    },
  ];
  try {
    const result = await adapter.generate({
      messages,
      isCancelled: () => isRunCancelled(run.id),
    });
    if (await isRunCancelled(run.id)) {
      await markCancelled(run.id);
      return;
    }
    const validation = validateCitations(result.content, sources.length);
    let content = validation.cleanedText;
    if (validation.removed.length > 0) {
      content += `\n\n> 注：已移除 ${validation.removed.length} 个无效来源引用（模型输出了不存在的编号，已按引用校验规则清理）。`;
    }
    const usedSourceIds = validation.used
      .map((idx) => sources.find((s) => s.index === idx)?.searchResultId)
      .filter((id): id is string => Boolean(id));
    await saveAssistantMessage(run, content, usedSourceIds, "COMPLETED", {
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
    });
    void recordUsage({
      workspaceId,
      kind: "MODEL",
      refType: "CONVERSATION_RUN",
      refId: run.id,
      provider: adapter.info.provider,
      model: adapter.info.model,
      promptTokens: result.usage?.promptTokens ?? null,
      completionTokens: result.usage?.completionTokens ?? null,
      costKnown: false,
      costNote: "模型服务未返回费用字段",
    });
    await markRun(run.id, { status: "COMPLETED", stage: "completed", finishedAt: new Date() });
  } catch (error) {
    if (await isRunCancelled(run.id)) {
      await markCancelled(run.id);
      return;
    }
    const payload =
      error instanceof ModelError
        ? { category: error.category, userMessage: error.userMessage }
        : { category: "PROVIDER_ERROR", userMessage: "模型调用失败，请稍后重试。" };
    // 搜索结果保留（run.sources / searchTaskId 不变），仅模型阶段失败
    await prisma.conversationRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        stage: "model_failed",
        modelError: payload.userMessage,
        errorCode: payload.category,
        finishedAt: new Date(),
      },
    });
  }
}

function buildSearchAnswerSystemPrompt(): string {
  return [
    "你是 GEO Radar 的搜索问答助手。回答规则：",
    "1. 只依据用户消息中提供的带编号搜索来源回答；来源没有覆盖的内容，明确说明“现有来源未覆盖”。",
    "2. 引用来源时使用 [编号] 形式（如 [1]、[2]），编号必须来自提供的来源列表；不要编造 URL 或来源。",
    "3. 用简体中文、Markdown 格式回答：先给结论，再分点展开；适合时用小标题和列表。",
    "4. 如果来源之间存在矛盾，指出矛盾而不是强行统一。",
    "5. 不要把搜索摘要说成已读取的网页全文；不要输出超出来源范围的价格、时间等时效性事实。",
  ].join("\n");
}

// ── 模式 B：搜索证据 ─────────────────────────────────────────
async function executeSearchEvidence(run: ConversationRun, workspaceId: string, userId: string): Promise<void> {
  const userMessage = await prisma.conversationMessage.findUniqueOrThrow({ where: { id: run.userMessageId } });
  await markRun(run.id, { status: "SEARCHING", stage: "searching" });
  const search = await runChatSearch({
    workspaceId,
    userId,
    conversationId: run.conversationId,
    runId: run.id,
    query: userMessage.content,
    brandId: run.brandId,
    isCancelled: () => isRunCancelled(run.id),
  });
  if (!search.ok) {
    await prisma.conversationRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        stage: "search_failed",
        searchTaskId: search.taskId,
        searchError: `[${search.errorCategory}] ${search.errorMessage ?? "搜索失败"}`,
        errorCode: search.errorCategory ?? "SEARCH_FAILED",
        finishedAt: new Date(),
      },
    });
    return;
  }
  await prisma.conversationRun.update({
    where: { id: run.id },
    data: { searchTaskId: search.taskId, searchItemId: search.itemId },
  });
  const { sources } = await getRunSourcesContext(run, 50);
  const parseNote = search.partialParseErrors ? `另有 ${search.partialParseErrors} 条结果解析失败已跳过。` : "";
  const content =
    sources.length > 0
      ? `搜索完成：返回 **${sources.length} 条真实结果**${parseNote}。请求 ID：\`${search.providerRequestId ?? "—"}\`（版本：${search.providerVersion ?? "—"}）。来源摘要（完整列表见下方来源卡片，可保存到证据库）：\n\n${sources
          .slice(0, 10)
          .map((s) => `- [${s.index}] ${s.title}（${s.domain ?? "未知域名"}${s.publishedAt ? `，${s.publishedAt}` : ""}）`)
          .join("\n")}`
      : `搜索完成但没有返回结果${parseNote}。请求 ID：\`${search.providerRequestId ?? "—"}\`。可尝试更换关键词重新搜索。`;
  await saveAssistantMessage(run, content, sources.map((s) => s.searchResultId), "COMPLETED");
  await markRun(run.id, { status: "COMPLETED", stage: "completed", finishedAt: new Date() });
}

// ── 模式 C：GEO 分析 ─────────────────────────────────────────
async function executeGeoAnalysis(run: ConversationRun, workspaceId: string, userId: string): Promise<void> {
  const userMessage = await prisma.conversationMessage.findUniqueOrThrow({ where: { id: run.userMessageId } });
  await markRun(run.id, { status: "SEARCHING", stage: "analyzing_saved_data" });

  // 优先使用已保存的真实数据（不自动发起新搜索）
  const brands = await prisma.brand.findMany({ where: { workspaceId }, select: { id: true, name: true } });
  const brandId = run.brandId ?? brands[0]?.id ?? null;
  const days = 30;
  const metrics = await computeOverviewMetrics(workspaceId, brandId ?? undefined, days);
  const brand = brandId ? await prisma.brand.findFirst({ where: { id: brandId, workspaceId } }) : null;
  const [sources, competitors, recentTasks] = await Promise.all([
    computeSourceDomains(workspaceId, brandId ?? undefined, days, 8),
    brandId ? computeCompetitorMetrics(workspaceId, brandId, days) : Promise.resolve([]),
    prisma.searchTask.findMany({
      where: { workspaceId, executionMode: "REAL", source: "LAB" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, status: true, successItems: true, failedItems: true, totalItems: true },
    }),
  ]);

  const dataSummary = {
    分析问题: userMessage.content,
    品牌: brand ? { name: brand.name, 官网域名: brand.websiteDomain } : null,
    统计范围: `近 ${days} 天（仅统计实验室真实任务，失败/取消的问题不计入分母）`,
    有效样本量: metrics.brandAppearance.validSamples,
    品牌出现率: metrics.brandAppearance.value,
    问题覆盖率: metrics.questionCoverage.value,
    官网来源覆盖率: metrics.officialSiteCoverage.value,
    已完成真实任务数: metrics.completedTasks,
    失败问题数: metrics.failedItemTotal,
    来源域名Top: sources,
    竞品出现率: competitors.map((c) => ({ name: c.name, rate: c.appearanceRate, samples: c.validSamples })),
    最近任务: recentTasks,
  };

  const enoughData = metrics.brandAppearance.validSamples > 0;
  const adapter = await loadModelAdapter(workspaceId, run.id, run.conversationId);
  await markRun(run.id, { status: "GENERATING", stage: "generating" });

  if (!enoughData) {
    // 数据不足：明确说明缺什么、能得出什么，不编造结论，也不自动发起新搜索
    const content = [
      "### 数据不足，无法得出可靠结论",
      "",
      `当前工作空间${brand ? `（品牌：${brand.name}）` : ""}近 ${days} 天内**没有有效的真实搜索样本**（有效样本量 = 0）。`,
      "",
      "目前的状态：",
      recentTasks.length > 0
        ? `- 找到 ${recentTasks.length} 个历史任务，但均未产生可统计的成功样本（可能全部失败或被取消）。`
        : "- 尚未执行任何实验室真实搜索任务。",
      "",
      "当前可以确认的：指标分母为空，品牌出现率/问题覆盖率/官网来源覆盖率均无法计算。",
      "暂时无法得出的：品牌是否被提及、竞品表现、官网引用情况。",
      "",
      "**建议下一步**：先在「搜索实验室」创建任务（选择品牌与包含启用状态问题的问题集）并完成执行；数据入库后回到本模式即可获得基于真实样本的分析。本模式不会自动发起搜索。"
        + (brand ? "" : "\n\n另外：尚未创建品牌档案，建议先在「品牌管理」中登记品牌与官网域名，官网来源覆盖率才能计算。"),
    ].join("\n");
    await saveAssistantMessage(run, content, [], "COMPLETED");
    await markRun(run.id, { status: "COMPLETED", stage: "completed_insufficient_data", finishedAt: new Date() });
    return;
  }

  if (!adapter) {
    // 无模型：基于规则的真实指标分析（明确标注「规则分析」）
    const fmt = (v: number | null) => (v === null ? "无法计算" : `${(v * 100).toFixed(1)}%`);
    const content = [
      "### GEO 指标分析（规则分析，未调用大模型）",
      "",
      `> 说明：未配置大模型，以下为业务代码基于真实数据计算的规则分析，不含模型生成内容。`,
      "",
      `**数据范围**：${dataSummary["统计范围"]}；有效样本 **${dataSummary["有效样本量"]}** 个问题（品牌：${brand?.name ?? "未指定"}）。`,
      "",
      "**关键指标**：",
      `- 品牌出现率：**${fmt(metrics.brandAppearance.value)}**（分子 ${metrics.brandAppearance.numerator}）`,
      `- 问题覆盖率：**${fmt(metrics.questionCoverage.value)}**`,
      `- 官网来源覆盖率：${metrics.officialSiteCoverage.value === null ? "无法计算（未配置官网域名）" : `**${fmt(metrics.officialSiteCoverage.value)}**`}`,
      "",
      "**来源域名 Top**：",
      sources.length > 0 ? sources.map((s) => `- ${s.domain}（${s.evidenceCount} 条证据 / ${s.questionCount} 个问题）`).join("\n") : "- 暂无来源数据",
      "",
      competitors.length > 0 ? "**竞品对比（同口径）**：\n" + competitors.map((c) => `- ${c.name}：${fmt(c.appearanceRate)}（样本 ${c.validSamples}）`).join("\n") : "尚未添加竞品。",
      "",
      `失败问题 ${metrics.failedItemTotal} 个（不计入分母）。「未检测到」仅表示样本中未出现，不代表品牌在全网无曝光。配置大模型后可获得更完整的解读。`,
    ].join("\n");
    await saveAssistantMessage(run, content, [], "COMPLETED");
    await markRun(run.id, { status: "COMPLETED", stage: "completed_rule_analysis", finishedAt: new Date() });
    return;
  }

  const systemPrompt = [
    "你是 GEO Radar 的 GEO 分析师。回答规则：",
    "1. 所有指标、样本量、域名、竞品数据只能来自用户消息中提供的 JSON 数据，禁止编造或推算数据中不存在的数字。",
    "2. 「未检测到」只能表述为“本次样本中未出现”，不得断言品牌在 AI 搜索生态中无曝光。",
    "3. 用简体中文 Markdown 输出：分析目标 / 数据范围与样本量 / 关键指标 / 主要发现 / 优化建议（附优先级）/ 下一步验证方法。",
    "4. 优化建议必须能对应到数据中的现象（例如某来源高频出现、某竞品在样本中占优）。",
  ].join("\n");
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `请基于以下真实统计数据回答我的问题：\n\n${userMessage.content}\n\n\`\`\`json\n${JSON.stringify(dataSummary, null, 2)}\n\`\`\``,
    },
  ];
  try {
    const result = await adapter.generate({ messages, isCancelled: () => isRunCancelled(run.id) });
    if (await isRunCancelled(run.id)) {
      await markCancelled(run.id);
      return;
    }
    await saveAssistantMessage(run, result.content, [], "COMPLETED", {
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
    });
    void recordUsage({
      workspaceId,
      kind: "MODEL",
      refType: "CONVERSATION_RUN",
      refId: run.id,
      provider: adapter.info.provider,
      model: adapter.info.model,
      promptTokens: result.usage?.promptTokens ?? null,
      completionTokens: result.usage?.completionTokens ?? null,
      costKnown: false,
      costNote: "模型服务未返回费用字段",
    });
    await markRun(run.id, { status: "COMPLETED", stage: "completed", finishedAt: new Date() });
  } catch (error) {
    if (await isRunCancelled(run.id)) {
      await markCancelled(run.id);
      return;
    }
    const payload =
      error instanceof ModelError
        ? { category: error.category, userMessage: error.userMessage }
        : { category: "PROVIDER_ERROR", userMessage: "模型调用失败。" };
    await prisma.conversationRun.update({
      where: { id: run.id },
      data: { status: "FAILED", stage: "model_failed", modelError: payload.userMessage, errorCode: payload.category, finishedAt: new Date() },
    });
  }
}

async function saveAssistantMessage(
  run: ConversationRun,
  content: string,
  sourceResultIds: string[],
  status: "COMPLETED" | "FAILED",
  usage?: { promptTokens?: number; completionTokens?: number }
) {
  const assistant = await prisma.conversationMessage.create({
    data: {
      conversationId: run.conversationId,
      role: "ASSISTANT",
      content,
      mode: run.mode,
      status,
      runId: run.id,
    },
  });
  await prisma.conversationRun.update({
    where: { id: run.id },
    data: {
      assistantMessageId: assistant.id,
      promptTokens: usage?.promptTokens ?? null,
      completionTokens: usage?.completionTokens ?? null,
    },
  });
  // 来源引用：只有真实使用的编号才写入
  for (let i = 0; i < sourceResultIds.length; i += 1) {
    const searchResultId = sourceResultIds[i];
    if (!searchResultId) continue;
    await prisma.searchSourceReference.create({
      data: { runId: run.id, searchResultId, citationIndex: i + 1 },
    }).catch(() => undefined);
  }
}

async function markCancelled(runId: string) {
  await prisma.conversationRun.update({
    where: { id: runId },
    data: { status: "CANCELLED", stage: "cancelled", errorCode: "CANCELLED", finishedAt: new Date() },
  });
}

/** 用户停止：置取消标记；执行器在阶段间与模型调用中检查。 */
export async function cancelRun(runId: string, workspaceId: string, userId: string) {
  const run = await prisma.conversationRun.findFirst({ where: { id: runId, conversation: { workspaceId } } });
  if (!run) throw new ConversationError("RUN_NOT_FOUND", "执行记录不存在");
  if (!["QUEUED", "SEARCHING", "GENERATING"].includes(run.status)) {
    throw new ConversationError("INVALID_RUN_STATE", `当前状态为 ${run.status}，无法停止`);
  }
  await prisma.conversationRun.update({ where: { id: runId }, data: { cancelRequested: true } });
  await writeAuditLog({
    workspaceId,
    userId,
    action: "CONVERSATION_RUN_CANCEL_REQUESTED",
    targetType: "ConversationRun",
    targetId: runId,
  });
}
