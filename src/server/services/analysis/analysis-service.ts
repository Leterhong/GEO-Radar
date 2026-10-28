import { prisma } from "@/server/db/client";
import { writeAuditLog } from "@/server/api/helpers";
import {
  computeAnswerMetrics,
  computeLabQuestionSetBreakdown,
  FORMULA_VERSION,
  type BrandTerms,
  type CorpusItem,
  type LabQuestionSetRow,
} from "./metrics-engine";
import type { AnalysisStatus } from "@prisma/client";

export class AnalysisError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

const MAX_DAYS = 365;

export interface CreateAnalysisInput {
  name: string;
  brandId?: string | null;
  days: number;
  keywordFilter?: string | null;
  competitorIds?: string[];
}

/** 创建分析任务（queued），执行不产生任何外部调用——只读取已保存条目。 */
export async function createAnalysisTask(workspaceId: string, userId: string, input: CreateAnalysisInput) {
  const name = input.name.trim();
  if (name === "") throw new AnalysisError("INVALID_NAME", "请填写分析任务名称");
  const days = Math.min(MAX_DAYS, Math.max(1, Math.floor(input.days || 30)));

  let brand: BrandTerms & { id: string; keywords: string[] } | null = null;
  if (input.brandId) {
    const record = await prisma.brand.findFirst({ where: { id: input.brandId, workspaceId } });
    if (!record) throw new AnalysisError("BRAND_NOT_FOUND", "品牌不存在或不属于当前工作空间");
    brand = {
      id: record.id,
      name: record.name,
      aliases: record.aliases,
      websiteDomain: record.websiteDomain,
      keywords: record.keywords,
    };
  }
  if (!brand) throw new AnalysisError("BRAND_REQUIRED", "请选择要分析的品牌");

  const competitorIds = (input.competitorIds ?? []).filter(Boolean);
  const competitors = await prisma.competitor.findMany({
    where: { workspaceId, brandId: brand.id, ...(competitorIds.length > 0 ? { id: { in: competitorIds } } : {}) },
    select: { id: true, name: true, aliases: true },
  });

  const task = await prisma.analysisTask.create({
    data: {
      workspaceId,
      brandId: brand.id,
      name,
      days,
      keywordFilter: input.keywordFilter?.trim() || null,
      competitorIds: competitors.map((c) => c.id),
      scope: {
        days,
        keywordFilter: input.keywordFilter?.trim() || null,
        competitorIds: competitors.map((c) => c.id),
        dataSource: "已保存的搜索问答回答与实验室任务（不新增外部搜索）",
      } as never,
      status: "QUEUED",
      createdById: userId,
    },
  });
  await writeAuditLog({
    workspaceId,
    userId,
    action: "ANALYSIS_TASK_CREATED",
    targetType: "AnalysisTask",
    targetId: task.id,
    metadata: { days, brandId: brand.id, competitors: competitors.length },
  });
  void runAnalysisTask(task.id).catch((error) => {
    console.error("[analysis] 执行异常:", error instanceof Error ? error.message : error);
  });
  return task;
}

/** 执行分析：收集已保存回答 → 确定性计算 → 落库指标。 */
export async function runAnalysisTask(taskId: string): Promise<void> {
  const task = await prisma.analysisTask.findUnique({
    where: { id: taskId },
    include: { brand: true },
  });
  if (!task) return;
  if (!task.brand) {
    await prisma.analysisTask.update({
      where: { id: taskId },
      data: { status: "FAILED", errorCode: "BRAND_MISSING", errorMessage: "品牌已被删除，无法分析。", finishedAt: new Date() },
    });
    return;
  }
  await prisma.analysisTask.update({
    where: { id: taskId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  try {
    const since = new Date(Date.now() - task.days * 24 * 60 * 60 * 1000);
    const runs = await prisma.conversationRun.findMany({
      where: {
        conversation: { workspaceId: task.workspaceId },
        mode: "SEARCH_ANSWER",
        status: "COMPLETED",
        finishedAt: { gte: since },
      },
      include: {
        userMessage: { select: { content: true } },
        assistantMessage: { select: { content: true } },
        sources: {
          include: {
            searchResult: {
              select: {
                url: true,
                domain: true,
                evidence: { select: { mentionStatus: true } },
              },
            },
          },
        },
      },
      orderBy: { finishedAt: "asc" },
      take: 2000,
    });

    const keywordFilter = task.keywordFilter?.toLowerCase();
    const corpus: CorpusItem[] = [];
    for (const run of runs) {
      if (!run.assistantMessage?.content) continue;
      const question = run.userMessage.content;
      if (keywordFilter && !question.toLowerCase().includes(keywordFilter)) continue;
      corpus.push({
        runId: run.id,
        question,
        answer: run.assistantMessage.content,
        answeredAt: (run.finishedAt ?? run.startedAt).toISOString(),
        sources: run.sources.map((s) => ({
          url: s.searchResult.url,
          domain: s.searchResult.domain,
          mentionStatus: s.searchResult.evidence[0]?.mentionStatus ?? "PENDING_REVIEW",
        })),
      });
    }

    const brandRecord = task.brand;
    const competitors = await prisma.competitor.findMany({
      where: { workspaceId: task.workspaceId, brandId: brandRecord.id, ...(task.competitorIds.length > 0 ? { id: { in: task.competitorIds } } : {}) },
      select: { id: true, name: true, aliases: true },
    });

    const brandTerms: BrandTerms = {
      name: brandRecord.name,
      aliases: brandRecord.aliases,
      websiteDomain: brandRecord.websiteDomain,
    };
    const computed = computeAnswerMetrics({
      corpus,
      brand: brandTerms,
      competitors,
      keywords: task.brand.keywords,
    });

    // 实验室任务补充维度
    const labRows = await buildLabQuestionSetRows(task.workspaceId, brandRecord.id, since);
    const labMetric = computeLabQuestionSetBreakdown(labRows);
    const allMetrics = [...computed.metrics, labMetric];

    const hasPartial =
      computed.answersWithoutSources > 0 || allMetrics.some((m) => m.insufficient && m.denominator === 0);

    await prisma.$transaction(async (tx) => {
      await tx.analysisMetric.deleteMany({ where: { taskId: task.id } });
      for (const metric of allMetrics) {
        await tx.analysisMetric.create({
          data: {
            taskId: task.id,
            key: metric.key,
            label: metric.label,
            value: metric.value,
            numerator: metric.numerator,
            denominator: metric.denominator,
            formulaVersion: FORMULA_VERSION,
            insufficient: metric.insufficient,
            notes: metric.notes,
            breakdown: (metric.breakdown ?? null) as never,
          },
        });
      }
      const status: AnalysisStatus = computed.answerCount === 0 ? "PARTIALLY_COMPLETED" : hasPartial ? "COMPLETED" : "COMPLETED";
      await tx.analysisTask.update({
        where: { id: task.id },
        data: {
          status,
          sampleSize: computed.sampleSize,
          answerCount: computed.answerCount,
          scopeNote:
            computed.answerCount === 0
              ? "统计范围内没有带来源的搜索问答回答，指标不可计算。"
              : `统计范围内 ${computed.sampleSize} 条搜索问答执行，其中 ${computed.answersWithoutSources} 条无可用来源未计入分母。`,
          finishedAt: new Date(),
        },
      });
      await tx.brand.update({
        where: { id: brandRecord.id },
        data: { lastAnalyzedAt: new Date() },
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.analysisTask.update({
      where: { id: taskId },
      data: { status: "FAILED", errorCode: "ANALYSIS_FAILED", errorMessage: message.slice(0, 500), finishedAt: new Date() },
    });
    throw error;
  }
}

async function buildLabQuestionSetRows(workspaceId: string, brandId: string, since: Date): Promise<LabQuestionSetRow[]> {
  const items = await prisma.searchTaskItem.findMany({
    where: {
      workspaceId,
      status: "SUCCESS",
      task: { executionMode: "REAL", source: "LAB", brandId, OR: [{ startedAt: { gte: since } }, { startedAt: null }] },
    },
    select: {
      questionId: true,
      question: { select: { questionSet: { select: { name: true } } } },
      results: { select: { evidence: { select: { mentionStatus: true } } } },
    },
  });
  const byQuestion = new Map<string, { questionSet: string; appeared: boolean }>();
  for (const item of items) {
    if (item.questionId === null) continue;
    const setName = item.question?.questionSet?.name ?? "未分类问题集";
    const appeared = item.results.some((r) => r.evidence.some((e) => e.mentionStatus === "CONFIRMED_BRAND"));
    const existing = byQuestion.get(item.questionId);
    if (!existing) byQuestion.set(item.questionId, { questionSet: setName, appeared });
    else if (appeared) existing.appeared = true;
  }
  const agg = new Map<string, LabQuestionSetRow>();
  for (const value of byQuestion.values()) {
    const row = agg.get(value.questionSet) ?? { questionSet: value.questionSet, validQuestions: 0, brandAppeared: 0 };
    row.validQuestions += 1;
    if (value.appeared) row.brandAppeared += 1;
    agg.set(value.questionSet, row);
  }
  return Array.from(agg.values()).sort((a, b) => b.validQuestions - a.validQuestions);
}

export async function cancelAnalysisTask(taskId: string, workspaceId: string, userId: string) {
  const task = await prisma.analysisTask.findFirst({ where: { id: taskId, workspaceId } });
  if (!task) throw new AnalysisError("NOT_FOUND", "分析任务不存在或不属于当前工作空间");
  if (task.status === "RUNNING" || task.status === "QUEUED") {
    await prisma.analysisTask.update({
      where: { id: taskId },
      data: { status: "CANCELLED", cancelRequested: true, finishedAt: new Date() },
    });
    await writeAuditLog({ workspaceId, userId, action: "ANALYSIS_TASK_CANCELLED", targetType: "AnalysisTask", targetId: taskId });
    return;
  }
  throw new AnalysisError("INVALID_STATE", `任务当前状态为 ${task.status}，无法取消`);
}

/** 重新执行（幂等：删除旧指标后重算，不新增外部调用）。 */
export async function retryAnalysisTask(taskId: string, workspaceId: string, userId: string) {
  const task = await prisma.analysisTask.findFirst({ where: { id: taskId, workspaceId } });
  if (!task) throw new AnalysisError("NOT_FOUND", "分析任务不存在或不属于当前工作空间");
  if (task.status === "RUNNING") throw new AnalysisError("INVALID_STATE", "任务正在执行中");
  await prisma.analysisTask.update({
    where: { id: taskId },
    data: { status: "QUEUED", errorCode: null, errorMessage: null, cancelRequested: false, finishedAt: null },
  });
  await writeAuditLog({ workspaceId, userId, action: "ANALYSIS_TASK_RETRIED", targetType: "AnalysisTask", targetId: taskId });
  void runAnalysisTask(taskId).catch(() => undefined);
}
