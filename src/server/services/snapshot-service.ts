import { createHash } from "crypto";
import { prisma } from "@/server/db/client";
import type { AnalysisSnapshot } from "@prisma/client";
import { pageKeyOf } from "@/lib/url-normalization";
import { EVIDENCE_RULE_VERSION, analyzeEvidencePage } from "./brand-matching";
import {
  buildRoundDataset,
  type EvidenceView,
  type MatrixQuestion,
  type RoundDataset,
  type RoundMetric,
  type PageTypeDistributionRow,
} from "./matrix-service";
import { writeAuditLog } from "@/server/api/helpers";

/**
 * 采集轮次快照：
 * - COLLECTION：采集完成时的分析结果，创建后不再修改；
 * - RECOMPUTE：使用当前品牌配置/规则重算的结果，与 COLLECTION 并列保存。
 * 原始搜索结果（SearchResult/RawSearchResponse）不会被重算覆盖。
 */

export const SNAPSHOT_SCHEMA_VERSION = "snapshot-v1";
const MAX_EVIDENCE_IN_SNAPSHOT = 2000;

export class SnapshotError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

function isoDate(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

/** 品牌/竞品配置指纹：配置变化后同样的规则版本也能产生新的重算快照 */
export function configFingerprint(dataset: Pick<RoundDataset, "brand" | "competitors">): string {
  const payload = JSON.stringify({
    brand: dataset.brand
      ? {
          name: dataset.brand.name,
          aliases: [...dataset.brand.aliases].sort(),
          websiteDomain: dataset.brand.websiteDomain,
          officialSubdomains: [...dataset.brand.officialSubdomains].sort(),
          products: [...dataset.brand.products].sort(),
          productAliases: [...dataset.brand.productAliases].sort(),
        }
      : null,
    competitors: dataset.competitors
      .map((c) => ({ name: c.name, aliases: [...c.aliases].sort(), websiteDomain: c.websiteDomain }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 12);
}

export function snapshotRuleVersion(dataset: Pick<RoundDataset, "brand" | "competitors">): string {
  return `${EVIDENCE_RULE_VERSION}+cfg-${configFingerprint(dataset)}`;
}

export interface SnapshotPayload {
  schemaVersion: string;
  task: RoundDataset["task"];
  brand: RoundDataset["brand"];
  competitors: RoundDataset["competitors"];
  entities: RoundDataset["entities"];
  counts: RoundDataset["counts"];
  questionSnapshot: Array<{
    itemId: string;
    questionId: string | null;
    questionText: string;
    category: string;
    itemStatus: string;
    resultCount: number;
    parseErrorCount: number;
    executedAt: string | null;
    cells: Array<{ entityKey: string; state: string; found: boolean; officialPageFound: boolean; thirdPartyPageFound: boolean; pageCount: number; evidenceCount: number }>;
  }>;
  evidenceSnapshot: Array<{
    id: string;
    questionKey: string;
    questionId: string | null;
    itemId: string | null;
    title: string;
    url: string;
    normalizedUrl: string | null;
    domain: string | null;
    snippet: string | null;
    publishedAt: string | null;
    requestId: string | null;
    pageType: string;
    sourceRole: string;
    mentionStatus: string;
    brandMatchBasis: string[];
    competitorMatches: string[];
    officialDomainMatch: boolean;
    thirdPartyMention: boolean;
    collectedAt: string;
  }>;
  truncated: boolean;
  limitations: string[];
}

function buildPayload(dataset: RoundDataset): SnapshotPayload {
  const evidence: SnapshotPayload["evidenceSnapshot"] = [];
  const seen = new Set<string>();
  let truncated = false;
  for (const question of dataset.questions) {
    const questionEvidence = dataset.evidence.filter(
      (ev) =>
        (question.itemId && ev.itemId === question.itemId) ||
        (question.questionId && ev.questionId === question.questionId)
    );
    for (const ev of questionEvidence) {
      if (evidence.length >= MAX_EVIDENCE_IN_SNAPSHOT) {
        truncated = true;
        break;
      }
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      evidence.push({
        id: ev.id,
        questionKey: question.key,
        questionId: ev.questionId,
        itemId: ev.itemId,
        title: ev.title,
        url: ev.url,
        normalizedUrl: ev.normalizedUrl,
        domain: ev.domain,
        snippet: ev.snippet,
        publishedAt: ev.publishedAt,
        requestId: ev.requestId,
        pageType: ev.pageType,
        sourceRole: ev.sourceRole,
        mentionStatus: ev.mentionStatus,
        brandMatchBasis: ev.brandMatchBasis,
        competitorMatches: ev.competitorMatches,
        officialDomainMatch: ev.officialDomainMatch,
        thirdPartyMention: ev.thirdPartyMention,
        collectedAt: ev.collectedAt,
      });
    }
    if (truncated) break;
  }
  // 兜底：关联不到具体问题的证据也保留摘要（最多到上限）
  if (!truncated) {
    for (const ev of dataset.evidence) {
      if (evidence.length >= MAX_EVIDENCE_IN_SNAPSHOT) {
        truncated = true;
        break;
      }
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      evidence.push({
        id: ev.id,
        questionKey: ev.questionId ?? "",
        questionId: ev.questionId,
        itemId: ev.itemId,
        title: ev.title,
        url: ev.url,
        normalizedUrl: ev.normalizedUrl,
        domain: ev.domain,
        snippet: ev.snippet,
        publishedAt: ev.publishedAt,
        requestId: ev.requestId,
        pageType: ev.pageType,
        sourceRole: ev.sourceRole,
        mentionStatus: ev.mentionStatus,
        brandMatchBasis: ev.brandMatchBasis,
        competitorMatches: ev.competitorMatches,
        officialDomainMatch: ev.officialDomainMatch,
        thirdPartyMention: ev.thirdPartyMention,
        collectedAt: ev.collectedAt,
      });
    }
  }
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    task: dataset.task,
    brand: dataset.brand,
    competitors: dataset.competitors,
    entities: dataset.entities,
    counts: dataset.counts,
    questionSnapshot: dataset.questions.map((q) => ({
      itemId: q.itemId,
      questionId: q.questionId,
      questionText: q.questionText,
      category: q.category,
      itemStatus: q.itemStatus,
      resultCount: q.resultCount,
      parseErrorCount: q.parseErrorCount,
      executedAt: q.executedAt,
      cells: q.cells.map((c) => ({
        entityKey: c.entityKey,
        state: c.state,
        found: c.found,
        officialPageFound: c.officialPageFound,
        thirdPartyPageFound: c.thirdPartyPageFound,
        pageCount: c.pageCount,
        evidenceCount: c.evidenceCount,
      })),
    })),
    evidenceSnapshot: evidence,
    truncated,
    limitations: dataset.limitations,
  };
}

/**
 * 创建快照。同一 taskId + kind + ruleVersion 已存在时直接返回（不可变）。
 */
export async function createTaskSnapshot(
  workspaceId: string,
  taskId: string,
  options: {
    kind?: "COLLECTION" | "RECOMPUTE";
    createdById?: string;
    forceErrorIfRunning?: boolean;
    /** 重试等场景的追加版本标记，避免与首次 COLLECTION 快照冲突 */
    ruleVersionTag?: string;
  } = {}
): Promise<AnalysisSnapshot> {
  const task = await prisma.searchTask.findFirst({
    where: { id: taskId, workspaceId },
    select: { id: true, status: true },
  });
  if (!task) throw new SnapshotError("TASK_NOT_FOUND", "任务不存在或不属于当前工作空间");
  if (task.status === "QUEUED" || task.status === "RUNNING") {
    throw new SnapshotError("TASK_RUNNING", "任务尚未执行完成，不能创建快照");
  }

  const dataset = await buildRoundDataset(workspaceId, taskId);
  const kind = options.kind ?? "COLLECTION";
  const baseRuleVersion = snapshotRuleVersion(dataset);
  const ruleVersion = options.ruleVersionTag ? `${baseRuleVersion}+${options.ruleVersionTag}` : baseRuleVersion;
  const existing = await prisma.analysisSnapshot.findFirst({
    where: { taskId, kind, ruleVersion, workspaceId },
  });
  if (existing) return existing;

  const payload = buildPayload(dataset);
  const summary = {
    taskName: dataset.task.name,
    status: dataset.task.status,
    executionMode: dataset.task.executionMode,
    isMock: dataset.task.isMock,
    brandName: dataset.brand?.name ?? null,
    brand: dataset.brand,
    competitors: dataset.competitors,
    questionSetVersion: dataset.task.questionSetVersion,
    counts: dataset.counts,
    limitations: dataset.limitations,
    ruleVersion,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  };

  const created = await prisma.analysisSnapshot.create({
    data: {
      workspaceId,
      taskId,
      kind,
      ruleVersion,
      questionSetVersionId: dataset.task.questionSetVersionId,
      questionSetVersion: dataset.task.questionSetVersion,
      summary: summary as never,
      metrics: dataset.metrics as never,
      matrix: {
        entities: dataset.entities,
        questions: dataset.questions.map((q) => ({
          key: q.key,
          itemId: q.itemId,
          questionId: q.questionId,
          questionText: q.questionText,
          category: q.category,
          itemStatus: q.itemStatus,
          state: q.state,
          cells: q.cells,
        })),
      } as never,
      pageTypeDistribution: dataset.pageTypeDistribution as never,
      questionSnapshot: payload.questionSnapshot as never,
      evidenceSnapshot: payload.evidenceSnapshot as never,
      evidenceCount: dataset.counts.totalEvidence,
      truncated: payload.truncated,
      createdById: options.createdById,
    },
  });
  return created;
}

export async function getTaskSnapshots(workspaceId: string, taskId: string) {
  return prisma.analysisSnapshot.findMany({
    where: { workspaceId, taskId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getLatestSnapshot(workspaceId: string, taskId: string, kind?: string) {
  return prisma.analysisSnapshot.findFirst({
    where: { workspaceId, taskId, ...(kind ? { kind } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

interface SnapshotSummaryShape {
  counts?: RoundDataset["counts"];
  brand?: RoundDataset["brand"];
  competitors?: RoundDataset["competitors"];
  limitations?: string[];
  questionSetVersion?: number | null;
}

interface SnapshotEvidenceShape {
  id: string;
  questionKey: string;
  questionId?: string | null;
  itemId?: string | null;
  title: string;
  url: string;
  normalizedUrl: string | null;
  domain: string | null;
  snippet?: string | null;
  publishedAt?: string | null;
  requestId?: string | null;
  pageType: string;
  sourceRole: string;
  mentionStatus: string;
  brandMatchBasis: string[];
  competitorMatches: string[];
  officialDomainMatch: boolean;
  thirdPartyMention: boolean;
  collectedAt: string;
}

/**
 * 从 COLLECTION / RECOMPUTE 快照重建只读分析数据集，用于历史比较。
 * 快照缺失或结构不完整时返回 null，由调用方回退到当前证据实时计算（并标注来源）。
 */
export async function getSnapshotRoundDataset(
  workspaceId: string,
  taskId: string,
  kind: "COLLECTION" | "RECOMPUTE" = "COLLECTION"
): Promise<RoundDataset | null> {
  const snapshot = await prisma.analysisSnapshot.findFirst({
    where: { workspaceId, taskId, kind },
    orderBy: { createdAt: "desc" },
  });
  if (!snapshot) return null;
  const task = await prisma.searchTask.findFirst({
    where: { id: taskId, workspaceId },
    include: {
      brand: {
        select: {
          id: true,
          name: true,
          websiteDomain: true,
          aliases: true,
          officialSubdomains: true,
          products: true,
          productAliases: true,
        },
      },
    },
  });
  if (!task) return null;

  const summary = (snapshot.summary ?? {}) as SnapshotSummaryShape;
  const matrix = snapshot.matrix as unknown as { entities?: RoundDataset["entities"]; questions?: MatrixQuestion[] } | null;
  if (!matrix || !Array.isArray(matrix.entities) || !Array.isArray(matrix.questions) || matrix.questions.length === 0) {
    return null;
  }
  const metrics = snapshot.metrics as unknown as RoundMetric[];
  if (!Array.isArray(metrics) || metrics.length === 0) return null;

  const brandSnapshot = (task.brandSnapshot ?? null) as
    | {
        brand?: RoundDataset["brand"];
        competitors?: RoundDataset["competitors"];
      }
    | null;
  const brand =
    summary.brand ??
    brandSnapshot?.brand ??
    (task.brand
      ? {
          id: task.brand.id,
          name: task.brand.name,
          websiteDomain: task.brand.websiteDomain,
          aliases: task.brand.aliases,
          officialSubdomains: task.brand.officialSubdomains ?? [],
          products: task.brand.products ?? [],
          productAliases: task.brand.productAliases ?? [],
        }
      : null);
  const competitors =
    summary.competitors ??
    brandSnapshot?.competitors ??
    (task.brandId
      ? (
          await prisma.competitor.findMany({ where: { workspaceId, brandId: task.brandId } })
        ).map((c) => ({ id: c.id, name: c.name, aliases: c.aliases, websiteDomain: c.websiteDomain }))
      : []);

  const questionByKey = new Map(matrix.questions.map((q) => [q.key, q]));
  const rawEvidence = Array.isArray(snapshot.evidenceSnapshot)
    ? (snapshot.evidenceSnapshot as unknown as SnapshotEvidenceShape[])
    : [];
  const evidence: EvidenceView[] = rawEvidence.map((ev) => {
    const question = questionByKey.get(ev.questionKey);
    return {
      id: ev.id,
      questionId: ev.questionId ?? question?.questionId ?? null,
      itemId: ev.itemId ?? question?.itemId ?? null,
      title: ev.title,
      url: ev.url,
      normalizedUrl: ev.normalizedUrl,
      domain: ev.domain,
      snippet: ev.snippet ?? null,
      publishedAt: ev.publishedAt ?? null,
      requestId: ev.requestId ?? null,
      pageType: ev.pageType as EvidenceView["pageType"],
      pageTypeRule: null,
      sourceRole: ev.sourceRole as EvidenceView["sourceRole"],
      mentionStatus: ev.mentionStatus,
      detectionMethod: "RULE",
      brandMatchBasis: ev.brandMatchBasis ?? [],
      matchedTerms: [],
      competitorMatches: ev.competitorMatches ?? [],
      officialDomainMatch: Boolean(ev.officialDomainMatch),
      thirdPartyMention: Boolean(ev.thirdPartyMention),
      relevance: "UNKNOWN",
      collectedAt: ev.collectedAt,
      reviewNote: null,
      reviewedAt: null,
    };
  });

  const counts: RoundDataset["counts"] =
    summary.counts ??
    (() => {
      const valid = matrix.questions.filter((q) => q.state !== "TASK_FAILED" && q.state !== "EMPTY" && q.state !== "NOT_COLLECTED");
      return {
        totalQuestions: matrix.questions.length,
        successItems: matrix.questions.filter((q) => q.itemStatus === "SUCCESS").length,
        failedItems: matrix.questions.filter((q) => q.itemStatus === "FAILED").length,
        emptyItems: matrix.questions.filter((q) => q.itemStatus === "SUCCESS" && q.resultCount === 0).length,
        cancelledItems: matrix.questions.filter((q) => q.itemStatus === "CANCELLED").length,
        notExecutedItems: matrix.questions.filter((q) => q.itemStatus === "PENDING" || q.itemStatus === "RUNNING").length,
        parseErrorItems: matrix.questions.filter((q) => q.parseErrorCount > 0).length,
        validQuestions: valid.length,
        needsReviewEvidence: evidence.filter((e) => e.mentionStatus === "PENDING_REVIEW").length,
        totalEvidence: evidence.length,
        uniquePages: new Set(evidence.map((e) => pageKeyOf(e.url))).size,
      };
    })();

  return {
    task: {
      id: task.id,
      name: task.name,
      brandId: task.brandId,
      brandName: brand?.name ?? null,
      executionMode: task.executionMode,
      provider: task.provider,
      status: task.status,
      source: task.source,
      questionSetId: task.questionSetId,
      questionSetVersionId: task.questionSetVersionId,
      questionSetVersion: task.questionSetVersion,
      baselineTaskId: task.baselineTaskId,
      startedAt: isoDate(task.startedAt),
      finishedAt: isoDate(task.finishedAt),
      createdAt: task.createdAt.toISOString(),
      params: (task.params ?? {}) as Record<string, unknown>,
      brandSnapshot: (task.brandSnapshot ?? null) as Record<string, unknown> | null,
      isMock: task.executionMode === "MOCK",
    },
    brand,
    competitors,
    entities: matrix.entities,
    questions: matrix.questions,
    evidence,
    metrics,
    pageTypeDistribution: (snapshot.pageTypeDistribution ?? []) as unknown as PageTypeDistributionRow[],
    counts,
    ruleVersion: snapshot.ruleVersion,
    limitations: summary.limitations ?? [],
  };
}

/**
 * 重新分析任务证据（只改分析层，不触碰 SearchResult/RawSearchResponse）。
 * 人工复核过的提及状态/页面类型不会被覆盖。
 */
export async function reanalyzeTaskEvidence(
  workspaceId: string,
  taskId: string,
  userId: string | null
): Promise<{ updated: number; skippedManual: number; snapshot: AnalysisSnapshot }> {
  const task = await prisma.searchTask.findFirst({
    where: { id: taskId, workspaceId },
    include: {
      brand: {
        select: {
          id: true,
          name: true,
          aliases: true,
          websiteDomain: true,
          officialSubdomains: true,
          products: true,
          productAliases: true,
        },
      },
    },
  });
  if (!task) throw new SnapshotError("TASK_NOT_FOUND", "任务不存在或不属于当前工作空间");
  if (task.status === "QUEUED" || task.status === "RUNNING") {
    throw new SnapshotError("TASK_RUNNING", "任务尚未执行完成，不能重新分析");
  }
  const competitors = task.brandId
    ? await prisma.competitor.findMany({ where: { workspaceId, brandId: task.brandId } })
    : [];

  const evidenceRows = await prisma.evidence.findMany({
    where: { workspaceId, taskId },
    include: { result: { select: { itemId: true } } },
  });

  let updated = 0;
  let skippedManual = 0;
  for (const evidence of evidenceRows) {
    const analysis = analyzeEvidencePage(
      {
        url: evidence.url,
        title: evidence.title,
        snippet: evidence.snippet,
        domain: evidence.domain,
      },
      task.brand
        ? {
            name: task.brand.name,
            aliases: task.brand.aliases,
            websiteDomain: task.brand.websiteDomain,
            officialSubdomains: task.brand.officialSubdomains,
            products: task.brand.products,
            productAliases: task.brand.productAliases,
          }
        : null,
      competitors.map((c) => ({ name: c.name, aliases: c.aliases, websiteDomain: c.websiteDomain }))
    );

    const manualMention = evidence.detectionMethod === "MANUAL";
    const manualPageType = evidence.pageTypeSource === "MANUAL";
    if (manualMention || manualPageType) skippedManual += 1;

    await prisma.evidence.update({
      where: { id: evidence.id },
      data: {
        normalizedUrl: analysis.normalizedUrl,
        pageType: manualPageType ? evidence.pageType : analysis.pageType,
        pageTypeRule: manualPageType ? evidence.pageTypeRule : analysis.pageTypeRule,
        sourceRole: analysis.sourceRole,
        officialDomainMatch: analysis.officialDomainMatch,
        thirdPartyMention: analysis.thirdPartyMention,
        brandMatchBasis: manualMention ? evidence.brandMatchBasis : analysis.brandMatchBasis,
        matchedTerms: manualMention ? evidence.matchedTerms : analysis.matchedTerms,
        competitorMatches: analysis.competitorMatches,
        mentionStatus: manualMention ? evidence.mentionStatus : analysis.mentionStatus,
        detectionMethod: evidence.detectionMethod,
        relevance: evidence.relevance === "UNKNOWN" ? analysis.relevance : evidence.relevance,
        ruleVersion: analysis.ruleVersion,
        analyzedAt: new Date(),
      },
    });
    updated += 1;
  }

  const snapshot = await createTaskSnapshot(workspaceId, taskId, {
    kind: "RECOMPUTE",
    createdById: userId ?? undefined,
  });
  await writeAuditLog({
    workspaceId,
    userId: userId ?? undefined,
    action: "EVIDENCE_REANALYZED",
    targetType: "SearchTask",
    targetId: taskId,
    metadata: { updated, skippedManual, ruleVersion: snapshot.ruleVersion, snapshotId: snapshot.id },
  });
  return { updated, skippedManual, snapshot };
}
