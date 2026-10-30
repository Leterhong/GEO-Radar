import { prisma } from "@/server/db/client";
import { writeAuditLog } from "@/server/api/helpers";
import { enabledQuestionsFromVersion, parseVersionQuestions } from "./question-set-service";
import { EVIDENCE_RULE_VERSION } from "./brand-matching";
import { env } from "@/lib/env";

/**
 * 手动复测：创建一轮全新的采集任务，关联上一轮任务。
 * 绝不复用上一轮结果冒充新结果；任务创建后仍需用户点击「开始执行」。
 */

export class RetestError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export interface CreateRetestInput {
  name?: string;
  description?: string;
  /** 可选：指定使用某个问题集版本（默认沿用基线任务的问题快照） */
  questionSetVersionId?: string;
}

export async function createRetestTask(
  workspaceId: string,
  userId: string,
  baselineTaskId: string,
  input: CreateRetestInput = {}
) {
  const baseline = await prisma.searchTask.findFirst({
    where: { id: baselineTaskId, workspaceId },
    include: {
      brand: {
        select: {
          id: true,
          name: true,
          englishName: true,
          aliases: true,
          websiteDomain: true,
          officialSubdomains: true,
          products: true,
          productAliases: true,
        },
      },
      items: { orderBy: { createdAt: "asc" } },
      questionSetVersionRef: true,
    },
  });
  if (!baseline) throw new RetestError("TASK_NOT_FOUND", "基线任务不存在或不属于当前工作空间");
  if (baseline.status === "QUEUED" || baseline.status === "RUNNING") {
    throw new RetestError("BASELINE_RUNNING", "基线任务尚未执行完成，无法复测");
  }
  if (baseline.items.length === 0) {
    throw new RetestError("NO_QUESTIONS", "基线任务没有问题记录，无法复测");
  }

  const recentRetest = await prisma.searchTask.findFirst({
    where: {
      workspaceId,
      baselineTaskId,
      status: { in: ["QUEUED", "RUNNING"] },
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
    select: { id: true },
  });
  if (recentRetest) {
    throw new RetestError(
      "DUPLICATE_RETEST",
      `60 秒内已为该基线创建复测任务（${recentRetest.id}），请勿重复提交。`
    );
  }

  let questions: Array<{ questionId: string | null; text: string; category: string | null }> = [];
  let questionSetId = baseline.questionSetId;
  let questionSetVersionId = baseline.questionSetVersionId;
  let questionSetVersion = baseline.questionSetVersion;

  if (input.questionSetVersionId) {
    const version = await prisma.questionSetVersion.findFirst({
      where: { id: input.questionSetVersionId, workspaceId },
    });
    if (!version) throw new RetestError("VERSION_NOT_FOUND", "指定的问题集版本不存在或不属于当前工作空间");
    questionSetId = version.questionSetId;
    questionSetVersionId = version.id;
    questionSetVersion = version.version;
    questions = enabledQuestionsFromVersion(version).map((q) => ({
      questionId: q.id,
      text: q.text,
      category: q.category,
    }));
  } else if (baseline.questionSetVersionRef) {
    // 沿用基线任务的版本快照，但按基线实际执行的问题范围筛选，保证可比
    const snapshot = parseVersionQuestions(baseline.questionSetVersionRef);
    const byId = new Map(snapshot.map((q) => [q.id, q]));
    questions = baseline.items.map((item) => {
      const snap = item.questionId ? byId.get(item.questionId) : undefined;
      return {
        questionId: item.questionId,
        text: snap?.text ?? item.questionText,
        category: snap?.category ?? item.categorySnapshot,
      };
    });
  } else {
    questions = baseline.items.map((item) => ({
      questionId: item.questionId,
      text: item.questionText,
      category: item.categorySnapshot,
    }));
  }

  if (questions.length === 0) throw new RetestError("NO_QUESTIONS", "没有可复测的问题");
  if (questions.length > env.maxQuestionsPerTask)
    throw new RetestError("TOO_MANY_QUESTIONS", `单次复测最多支持 ${env.maxQuestionsPerTask} 个问题`);

  const competitors = baseline.brandId
    ? await prisma.competitor.findMany({ where: { workspaceId, brandId: baseline.brandId, enabled: true } })
    : [];

  const brandSnapshot = {
    capturedAt: new Date().toISOString(),
    ruleVersion: EVIDENCE_RULE_VERSION,
    brand: baseline.brand
      ? {
          id: baseline.brand.id,
          name: baseline.brand.name,
          englishName: baseline.brand.englishName,
          aliases: baseline.brand.aliases,
          websiteDomain: baseline.brand.websiteDomain,
          officialSubdomains: baseline.brand.officialSubdomains,
          products: baseline.brand.products,
          productAliases: baseline.brand.productAliases,
        }
      : null,
    competitors: competitors.map((c) => ({
      id: c.id,
      name: c.name,
      aliases: c.aliases,
      websiteDomain: c.websiteDomain,
    })),
    retestOf: baseline.id,
    baselineQuestionSetVersion: baseline.questionSetVersion,
  };

  const name = (input.name?.trim() || `${baseline.name} · 复测 ${new Date().toISOString().slice(0, 10)}`).slice(0, 100);

  const task = await prisma.searchTask.create({
    data: {
      workspaceId,
      brandId: baseline.brandId,
      name,
      description: input.description?.trim() || `基于「${baseline.name}」的复测任务`,
      provider: baseline.provider,
      executionMode: baseline.executionMode,
      status: "QUEUED",
      source: baseline.source === "SCHEDULE" ? "SCHEDULE" : "LAB",
      questionSetId,
      questionSetVersionId,
      questionSetVersion,
      totalItems: questions.length,
      params: (baseline.params ?? {}) as never,
      brandSnapshot: brandSnapshot as never,
      baselineTaskId: baseline.id,
      createdById: userId,
      items: {
        create: questions.map((q) => ({
          workspaceId,
          questionId: q.questionId ?? undefined,
          questionText: q.text,
          categorySnapshot: q.category,
        })),
      },
    },
  });

  await writeAuditLog({
    workspaceId,
    userId,
    action: "RETEST_TASK_CREATED",
    targetType: "SearchTask",
    targetId: task.id,
    metadata: { baselineTaskId: baseline.id, totalItems: questions.length },
  });
  return task;
}

/** 查询任务所属复测链（向前追溯基线，向后查找复测）。 */
export async function getRetestChain(workspaceId: string, taskId: string) {
  const task = await prisma.searchTask.findFirst({
    where: { id: taskId, workspaceId },
    select: {
      id: true,
      name: true,
      baselineTaskId: true,
      status: true,
      finishedAt: true,
      questionSetVersion: true,
    },
  });
  if (!task) throw new RetestError("TASK_NOT_FOUND", "任务不存在或不属于当前工作空间");
  const [baseline, retests] = await Promise.all([
    task.baselineTaskId
      ? prisma.searchTask.findFirst({
          where: { id: task.baselineTaskId, workspaceId },
          select: { id: true, name: true, status: true, finishedAt: true, questionSetVersion: true },
        })
      : null,
    prisma.searchTask.findMany({
      where: { workspaceId, baselineTaskId: taskId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, status: true, finishedAt: true, questionSetVersion: true },
    }),
  ]);
  return { task, baseline, retests };
}
