import { prisma } from "@/server/db/client";
import type { Prisma, Question, QuestionSetVersion } from "@prisma/client";

/**
 * 问题集版本化：
 * - 任何问题内容变更都会生成新的不可变版本快照；
 * - 历史任务引用创建时的版本，不随当前问题集编辑而变化；
 * - 复制问题集生成一个全新的问题集（版本 1），不共享历史。
 */

export interface QuestionSnapshot {
  id: string;
  text: string;
  category: string | null;
  intent: string | null;
  priority: number;
  enabled: boolean;
  version: number;
  createdAt: string;
}

export class QuestionSetError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

function toSnapshot(question: Question, version: number): QuestionSnapshot {
  return {
    id: question.id,
    text: question.text,
    category: question.category,
    intent: question.intent,
    priority: question.priority,
    enabled: question.enabled,
    version,
    createdAt: question.createdAt.toISOString(),
  };
}

/** 比较两份问题快照的内容（忽略版本号本身） */
function snapshotContent(questions: QuestionSnapshot[]): string {
  return JSON.stringify(
    [...questions]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((q) => ({
        id: q.id,
        text: q.text,
        category: q.category ?? null,
        intent: q.intent ?? null,
        priority: q.priority,
        enabled: q.enabled,
      }))
  );
}

export function parseVersionQuestions(version: Pick<QuestionSetVersion, "questions">): QuestionSnapshot[] {
  const raw = version.questions;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (item === null || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.text !== "string") return [];
    return [
      {
        id: row.id,
        text: row.text,
        category: typeof row.category === "string" ? row.category : null,
        intent: typeof row.intent === "string" ? row.intent : null,
        priority: typeof row.priority === "number" ? row.priority : 3,
        enabled: typeof row.enabled === "boolean" ? row.enabled : true,
        version: typeof row.version === "number" ? row.version : 1,
        createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date(0).toISOString(),
      },
    ];
  });
}

async function loadVersionContext(workspaceId: string, questionSetId: string) {
  const set = await prisma.questionSet.findFirst({ where: { id: questionSetId, workspaceId } });
  if (!set) throw new QuestionSetError("QUESTION_SET_NOT_FOUND", "问题集不存在或不属于当前工作空间");
  const [questions, latest] = await Promise.all([
    prisma.question.findMany({
      where: { questionSetId },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    }),
    prisma.questionSetVersion.findFirst({
      where: { questionSetId },
      orderBy: { version: "desc" },
    }),
  ]);
  return { set, questions, latest };
}

/**
 * 发布新版本：若内容与最新版本一致，则不产生新版本（幂等）。
 * changedQuestionIds 中的问题会把 version 更新为新版本号。
 */
export async function publishQuestionSetVersion(
  workspaceId: string,
  questionSetId: string,
  userId: string | null,
  options: { changedQuestionIds?: string[]; note?: string; force?: boolean } = {}
): Promise<QuestionSetVersion> {
  const { set, questions, latest } = await loadVersionContext(workspaceId, questionSetId);
  const changed = new Set(options.changedQuestionIds ?? []);
  const candidateVersion = (latest?.version ?? 0) + 1;

  const shouldBumpQuestionVersion = (questionId: string): boolean =>
    changed.size === 0 ? false : changed.has(questionId);

  const snapshots = questions.map((q) =>
    toSnapshot(q, shouldBumpQuestionVersion(q.id) ? candidateVersion : q.version)
  );

  if (!options.force && latest) {
    const latestQuestions = parseVersionQuestions(latest);
    const sameContent = snapshotContent(latestQuestions) === snapshotContent(snapshots);
    const sameMeta = latest.name === set.name && (latest.description ?? "") === (set.description ?? "");
    if (sameContent && sameMeta) {
      return latest;
    }
  }

  const nextVersion = candidateVersion;

  const created = await prisma.$transaction(async (tx) => {
    if (changed.size > 0) {
      await tx.question.updateMany({
        where: { questionSetId, id: { in: Array.from(changed) } },
        data: { version: nextVersion },
      });
    }
    const version = await tx.questionSetVersion.create({
      data: {
        workspaceId,
        questionSetId,
        version: nextVersion,
        name: set.name,
        description: set.description,
        questions: snapshots as never,
        questionCount: snapshots.length,
        enabledCount: snapshots.filter((q) => q.enabled).length,
        note: options.note,
        createdById: userId ?? undefined,
      },
    });
    await tx.questionSet.update({ where: { id: questionSetId }, data: { currentVersion: nextVersion } });
    return version;
  });
  return created;
}

/** 创建问题集时初始化版本 1（空问题集也保存，保证版本链完整）。 */
export async function createInitialQuestionSetVersion(
  tx: Prisma.TransactionClient,
  set: { id: string; workspaceId: string; name: string; description: string | null },
  questions: Question[],
  userId: string | null
): Promise<void> {
  await tx.questionSetVersion.create({
    data: {
      workspaceId: set.workspaceId,
      questionSetId: set.id,
      version: 1,
      name: set.name,
      description: set.description,
      questions: questions.map((q) => toSnapshot(q, 1)) as never,
      questionCount: questions.length,
      enabledCount: questions.filter((q) => q.enabled).length,
      note: "初始版本",
      createdById: userId ?? undefined,
    },
  });
  await tx.questionSet.update({ where: { id: set.id }, data: { currentVersion: 1 } });
}

/**
 * 为采集任务取得当前可用版本：
 * - 最新版本内容与当前问题一致 → 直接复用；
 * - 内容已变更但未发布 → 自动发布新版本（避免历史任务与当前问题混淆）。
 */
export async function ensureVersionForTask(
  workspaceId: string,
  questionSetId: string,
  userId: string | null
): Promise<QuestionSetVersion> {
  const { set, questions, latest } = await loadVersionContext(workspaceId, questionSetId);
  if (!latest) {
    const snapshots = questions.map((q) => toSnapshot(q, 1));
    return prisma.questionSetVersion.create({
      data: {
        workspaceId,
        questionSetId,
        version: 1,
        name: set.name,
        description: set.description,
        questions: snapshots as never,
        questionCount: snapshots.length,
        enabledCount: snapshots.filter((q) => q.enabled).length,
        note: "首次采集前快照",
        createdById: userId ?? undefined,
      },
    });
  }
  const latestQuestions = parseVersionQuestions(latest);
  const sameContent = snapshotContent(latestQuestions) === snapshotContent(questions.map((q) => toSnapshot(q, q.version)));
  if (sameContent) return latest;
  return publishQuestionSetVersion(workspaceId, questionSetId, userId, {
    note: "采集前检测到问题内容变更，自动发布新版本",
    changedQuestionIds: questions.map((q) => q.id),
  });
}

/** 启用问题（按版本快照，不读取当前 Question 表） */
export function enabledQuestionsFromVersion(version: Pick<QuestionSetVersion, "questions">): QuestionSnapshot[] {
  return parseVersionQuestions(version)
    .filter((q) => q.enabled)
    .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
}

export interface CopyQuestionSetResult {
  questionSetId: string;
  name: string;
  questionCount: number;
  version: number;
}

/** 复制问题集：新集合、新问题 ID、版本 1；不复制任何采集历史。 */
export async function copyQuestionSet(
  workspaceId: string,
  userId: string,
  sourceQuestionSetId: string,
  name?: string
): Promise<CopyQuestionSetResult> {
  const source = await prisma.questionSet.findFirst({
    where: { id: sourceQuestionSetId, workspaceId },
    include: { questions: { orderBy: [{ priority: "desc" }, { createdAt: "asc" }] } },
  });
  if (!source) throw new QuestionSetError("QUESTION_SET_NOT_FOUND", "问题集不存在或不属于当前工作空间");

  const copyName = (name?.trim() || `${source.name}（副本）`).slice(0, 100);
  const created = await prisma.$transaction(async (tx) => {
    const set = await tx.questionSet.create({
      data: {
        workspaceId,
        name: copyName,
        description: source.description,
        currentVersion: 1,
      },
    });
    const questions: Question[] = [];
    for (const question of source.questions) {
      const row = await tx.question.create({
        data: {
          workspaceId,
          questionSetId: set.id,
          text: question.text,
          category: question.category,
          intent: question.intent,
          region: question.region,
          language: question.language,
          priority: question.priority,
          enabled: question.enabled,
          version: 1,
        },
      });
      questions.push(row);
    }
    await createInitialQuestionSetVersion(tx, set, questions, userId);
    return { set, count: questions.length };
  });
  return { questionSetId: created.set.id, name: created.set.name, questionCount: created.count, version: 1 };
}

/** 归档问题集：保留历史任务与版本；同时暂停引用它的定时排期，避免后续执行失败。 */
export async function archiveQuestionSet(workspaceId: string, questionSetId: string): Promise<void> {
  const set = await prisma.questionSet.findFirst({ where: { id: questionSetId, workspaceId } });
  if (!set) throw new QuestionSetError("QUESTION_SET_NOT_FOUND", "问题集不存在或不属于当前工作空间");
  await prisma.$transaction([
    prisma.questionSet.update({ where: { id: questionSetId }, data: { archivedAt: new Date() } }),
    prisma.schedule.updateMany({
      where: { workspaceId, questionSetId, status: "ACTIVE" },
      data: { status: "PAUSED", nextRunAt: null },
    }),
  ]);
}
