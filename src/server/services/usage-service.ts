import { prisma } from "@/server/db/client";
import type { UsageKind } from "@prisma/client";

/** 记录一次真实发生的外部调用（仅记录实际执行，未执行不记录）。 */
export async function recordUsage(entry: {
  workspaceId: string;
  kind: UsageKind;
  refType: string;
  refId?: string | null;
  provider: string;
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  costKnown?: boolean;
  costNote?: string | null;
}): Promise<void> {
  try {
    await prisma.usageRecord.create({
      data: {
        workspaceId: entry.workspaceId,
        kind: entry.kind,
        refType: entry.refType,
        refId: entry.refId ?? null,
        provider: entry.provider,
        model: entry.model ?? null,
        promptTokens: entry.promptTokens ?? null,
        completionTokens: entry.completionTokens ?? null,
        costKnown: entry.costKnown ?? false,
        costNote: entry.costNote ?? null,
      },
    });
  } catch (error) {
    // 用量记录失败不应影响主流程
    console.error("[usage] 写入用量记录失败:", error instanceof Error ? error.message : error);
  }
}

export interface UsageSummary {
  since: string;
  days: number;
  searches: { total: number; failed: number };
  modelCalls: { total: number; failed: number };
  tokens: { prompt: number | null; completion: number | null; total: number | null };
  cost: { known: boolean; note: string };
  byDay: Array<{ date: string; searches: number; modelCalls: number; tokens: number | null }>;
  recent: Array<{
    id: string;
    kind: UsageKind;
    provider: string;
    model: string | null;
    promptTokens: number | null;
    completionTokens: number | null;
    createdAt: string;
  }>;
}

/**
 * 用量统计：同时读取 UsageRecord（自本版本起）与历史表（SearchTaskItem / ConversationRun），
 * 去重口径：搜索以 SearchTaskItem.executedAt 为准，模型以 ConversationRun.modelName 非空且已结束为准。
 * 费用：外部服务未提供单价，一律显示未知，不做估算。
 */
export async function getUsageSummary(workspaceId: string, days: number): Promise<UsageSummary> {
  const safeDays = Math.min(365, Math.max(1, Math.floor(days || 30)));
  const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

  const [searchItems, modelRuns, usageRecords] = await Promise.all([
    prisma.searchTaskItem.findMany({
      where: { workspaceId, executedAt: { gte: since } },
      select: { status: true, executedAt: true },
    }),
    prisma.conversationRun.findMany({
      where: {
        conversation: { workspaceId },
        modelName: { not: null },
        finishedAt: { gte: since },
      },
      select: { status: true, promptTokens: true, completionTokens: true, finishedAt: true, modelName: true },
    }),
    prisma.usageRecord.findMany({
      where: { workspaceId, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const searches = { total: searchItems.length, failed: searchItems.filter((i) => i.status === "FAILED").length };
  const modelCalls = { total: modelRuns.length, failed: modelRuns.filter((r) => r.status === "FAILED").length };

  let prompt: number | null = null;
  let completion: number | null = null;
  let sawTokens = false;
  for (const run of modelRuns) {
    if (run.promptTokens !== null || run.completionTokens !== null) {
      sawTokens = true;
      prompt = (prompt ?? 0) + (run.promptTokens ?? 0);
      completion = (completion ?? 0) + (run.completionTokens ?? 0);
    }
  }

  const byDayMap = new Map<string, { searches: number; modelCalls: number; tokens: number }>();
  for (const item of searchItems) {
    if (!item.executedAt) continue;
    const day = item.executedAt.toISOString().slice(0, 10);
    const entry = byDayMap.get(day) ?? { searches: 0, modelCalls: 0, tokens: 0 };
    entry.searches += 1;
    byDayMap.set(day, entry);
  }
  let anyDayTokens = false;
  for (const run of modelRuns) {
    if (!run.finishedAt) continue;
    const day = run.finishedAt.toISOString().slice(0, 10);
    const entry = byDayMap.get(day) ?? { searches: 0, modelCalls: 0, tokens: 0 };
    entry.modelCalls += 1;
    if (run.promptTokens !== null || run.completionTokens !== null) {
      entry.tokens += (run.promptTokens ?? 0) + (run.completionTokens ?? 0);
      anyDayTokens = true;
    }
    byDayMap.set(day, entry);
  }

  return {
    since: since.toISOString(),
    days: safeDays,
    searches,
    modelCalls,
    tokens: sawTokens ? { prompt, completion, total: (prompt ?? 0) + (completion ?? 0) } : { prompt: null, completion: null, total: null },
    cost: {
      known: false,
      note: "搜索与模型服务未返回费用数据，GEO Radar 不做估算，请以服务商账单为准。",
    },
    byDay: Array.from(byDayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, entry]) => ({
        date,
        searches: entry.searches,
        modelCalls: entry.modelCalls,
        tokens: anyDayTokens ? entry.tokens : null,
      })),
    recent: usageRecords.map((r) => ({
      id: r.id,
      kind: r.kind,
      provider: r.provider,
      model: r.model,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
