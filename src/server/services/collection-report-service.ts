import { prisma } from "@/server/db/client";
import type { Report } from "@prisma/client";
import { writeAuditLog } from "@/server/api/helpers";
import { pageKeyOf } from "@/lib/url-normalization";
import { URL_NORMALIZATION_VERSION } from "@/lib/url-normalization";
import {
  buildRoundDataset,
  pageTypeLabel,
  matrixCellStateLabel,
  METRICS_VERSION,
  type RoundDataset,
  type RoundMetric,
  type MatrixQuestion,
  type PageTypeDistributionRow,
} from "./matrix-service";
import { compareTaskRounds, COMPARISON_VERSION, ComparisonError, type ComparisonResult } from "./comparison-service";
import { createTaskSnapshot, snapshotRuleVersion, SNAPSHOT_SCHEMA_VERSION } from "./snapshot-service";
import { describeBasis, EVIDENCE_RULE_VERSION } from "./brand-matching";
import { isConfiguredOfficialHost } from "@/lib/domain-utils";

/**
 * 以证据为中心的 GEO 分析报告（可复算、可追溯）。
 * 报告保存生成时快照；指标由确定性的服务端代码计算，不调用大模型。
 */

export const COLLECTION_REPORT_SCHEMA = "search-report-v1";

export class CollectionReportError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export interface ReportEvidence {
  id: string;
  title: string;
  url: string;
  domain: string | null;
  pageType: string;
  pageTypeLabel: string;
  sourceRole: string;
  mentionStatus: string;
  matchBasis: string[];
  matchBasisLabels: string[];
  competitorMatches: string[];
  questionText: string;
  collectedAt: string;
  requestId: string | null;
}

export interface ReportSuggestion {
  id: string;
  title: string;
  detail: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  evidenceIds: string[];
  questionRefs: string[];
  caution: string;
}

export interface OfficialCoverage {
  websiteDomain: string | null;
  officialSubdomains: string[];
  questionsWithOfficialPage: number;
  officialPageCount: number;
  officialPages: Array<{ title: string; url: string; domain: string | null; pageType: string; pageTypeLabel: string; evidenceId: string }>;
  pageTypeBreakdown: Array<{ pageType: string; label: string; count: number }>;
}

export interface CollectionReportSnapshot {
  schemaVersion: typeof COLLECTION_REPORT_SCHEMA;
  reportTitle: string;
  generatedAt: string;
  dataVersion: {
    metricsVersion: string;
    evidenceRuleVersion: string;
    urlNormalizationVersion: string;
    snapshotSchemaVersion: string;
    reportedRuleVersion: string;
    comparisonVersion: string;
    snapshotIds: Array<{ id: string; taskId: string; kind: string; ruleVersion: string; createdAt: string }>;
  };
  brand: {
    id: string;
    name: string;
    websiteDomain: string | null;
    aliases: string[];
    officialSubdomains: string[];
    products: string[];
  } | null;
  competitors: Array<{ id: string; name: string; websiteDomain: string | null }>;
  task: {
    id: string;
    name: string;
    status: string;
    executionMode: string;
    provider: string;
    source: string;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
    questionSetId: string | null;
    questionSetVersionId: string | null;
    questionSetVersion: number | null;
    questionSetName: string | null;
    baselineTaskId: string | null;
    failureReason: string | null;
    params: Record<string, unknown>;
  };
  collection: {
    totalQuestions: number;
    successItems: number;
    failedItems: number;
    emptyItems: number;
    cancelledItems: number;
    notExecutedItems: number;
    parseErrorItems: number;
    validQuestions: number;
    successRate: number | null;
    dataWindowFrom: string;
    dataWindowTo: string;
    durationMs: number | null;
    isMock: boolean;
  };
  metrics: RoundMetric[];
  matrix: {
    entities: RoundDataset["entities"];
    questions: MatrixQuestion[];
  };
  officialCoverage: OfficialCoverage;
  pageTypeDistribution: PageTypeDistributionRow[];
  representativeEvidence: ReportEvidence[];
  comparison: ComparisonResult | null;
  volatility: ComparisonResult["volatility"] | null;
  optimizationEvents: ComparisonResult["optimizationEvents"];
  limitations: string[];
  suggestions: ReportSuggestion[];
  methodology: string[];
}

const PERCENT = (value: number | null) => (value === null ? "不可计算" : `${(value * 100).toFixed(1)}%`);

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "／").replace(/\n/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

function selectRepresentativeEvidence(dataset: RoundDataset): ReportEvidence[] {
  const questionTextById = new Map<string, string>();
  const questionTextByItem = new Map<string, string>();
  for (const q of dataset.questions) {
    if (q.questionId) questionTextById.set(q.questionId, q.questionText);
    questionTextByItem.set(q.itemId, q.questionText);
  }
  const questionOf = (questionId: string | null, itemId: string | null) =>
    (questionId ? questionTextById.get(questionId) : undefined) ?? (itemId ? questionTextByItem.get(itemId) : undefined) ?? "（问题文本不可用）";

  const priority = (ev: RoundDataset["evidence"][number]): number => {
    if (ev.officialDomainMatch) return 0;
    if (ev.brandMatchBasis.some((b) => b.startsWith("TITLE_"))) return 1;
    if (ev.relevance === "HIGH") return 2;
    if (ev.thirdPartyMention) return 3;
    return 4;
  };

  const sorted = [...dataset.evidence].sort((a, b) => priority(a) - priority(b));
  const seenPages = new Set<string>();
  const selected: ReportEvidence[] = [];
  for (const ev of sorted) {
    const key = pageKeyOf(ev.url);
    if (seenPages.has(key)) continue;
    // 只保留品牌相关或竞品相关证据，避免把无关结果当作代表证据
    const related = ev.mentionStatus === "CONFIRMED_BRAND" || ev.officialDomainMatch || ev.competitorMatches.length > 0;
    if (!related) continue;
    seenPages.add(key);
    selected.push({
      id: ev.id,
      title: ev.title,
      url: ev.url,
      domain: ev.domain,
      pageType: ev.pageType,
      pageTypeLabel: pageTypeLabel(ev.pageType),
      sourceRole: ev.sourceRole,
      mentionStatus: ev.mentionStatus,
      matchBasis: ev.brandMatchBasis,
      matchBasisLabels: ev.brandMatchBasis.map(describeBasis),
      competitorMatches: ev.competitorMatches,
      questionText: questionOf(ev.questionId, ev.itemId),
      collectedAt: ev.collectedAt,
      requestId: ev.requestId,
    });
    if (selected.length >= 12) break;
  }
  return selected;
}

function buildOfficialCoverage(dataset: RoundDataset): OfficialCoverage {
  const brand = dataset.brand;
  const officialEvidence = dataset.evidence.filter(
    (ev) => ev.officialDomainMatch || isConfiguredOfficialHost(ev.domain, brand?.websiteDomain, brand?.officialSubdomains)
  );
  const pages = new Map<string, ReportEvidence>();
  for (const ev of officialEvidence) {
    const key = pageKeyOf(ev.url);
    if (!pages.has(key)) {
      pages.set(key, {
        id: ev.id,
        title: ev.title,
        url: ev.url,
        domain: ev.domain,
        pageType: ev.pageType,
        pageTypeLabel: pageTypeLabel(ev.pageType),
        sourceRole: ev.sourceRole,
        mentionStatus: ev.mentionStatus,
        matchBasis: ev.brandMatchBasis,
        matchBasisLabels: ev.brandMatchBasis.map(describeBasis),
        competitorMatches: ev.competitorMatches,
        questionText: "",
        collectedAt: ev.collectedAt,
        requestId: ev.requestId,
      });
    }
  }
  const brandEntity = dataset.entities.find((e) => e.kind === "BRAND");
  const questionsWithOfficialPage = brandEntity
    ? dataset.questions.filter((q) => q.cells.find((c) => c.entityKey === brandEntity.key)?.officialPageFound === true).length
    : 0;
  const typeCounts = new Map<string, number>();
  for (const page of pages.values()) typeCounts.set(page.pageType, (typeCounts.get(page.pageType) ?? 0) + 1);
  return {
    websiteDomain: brand?.websiteDomain ?? null,
    officialSubdomains: brand?.officialSubdomains ?? [],
    questionsWithOfficialPage,
    officialPageCount: pages.size,
    officialPages: Array.from(pages.values())
      .slice(0, 20)
      .map((page) => ({
        title: page.title,
        url: page.url,
        domain: page.domain,
        pageType: page.pageType,
        pageTypeLabel: page.pageTypeLabel,
        evidenceId: page.id,
      })),
    pageTypeBreakdown: Array.from(typeCounts.entries()).map(([pageType, count]) => ({
      pageType,
      label: pageTypeLabel(pageType as never),
      count,
    })),
  };
}

function buildSuggestions(
  dataset: RoundDataset,
  comparison: ComparisonResult | null
): ReportSuggestion[] {
  const suggestions: ReportSuggestion[] = [];
  const brandEntity = dataset.entities.find((e) => e.kind === "BRAND");
  const brandCell = (q: MatrixQuestion) =>
    brandEntity ? q.cells.find((c) => c.entityKey === brandEntity.key) : undefined;
  const validQuestions = dataset.questions.filter((q) => brandCell(q) !== undefined);
  const questionsWithBrand = dataset.questions.filter((q) => brandCell(q)?.found === true);
  const questionsWithoutBrand = validQuestions.filter((q) => brandCell(q)?.found !== true);
  const productQuestions = questionsWithoutBrand.filter((q) => /产品|功能|对比|购买|决策|价格|方案/.test(q.category));
  const thirdPartyEvidence = dataset.evidence.filter(
    (ev) => ev.thirdPartyMention && ev.mentionStatus === "CONFIRMED_BRAND"
  );
  const thirdPartyDomains = new Map<string, string[]>();
  for (const ev of thirdPartyEvidence) {
    if (!ev.domain) continue;
    thirdPartyDomains.set(ev.domain, [...(thirdPartyDomains.get(ev.domain) ?? []), ev.id]);
  }
  const needsReview = dataset.evidence.filter((ev) => ev.mentionStatus === "PENDING_REVIEW");

  if (!dataset.brand?.websiteDomain && (dataset.brand?.officialSubdomains ?? []).length === 0) {
    suggestions.push({
      id: "CONFIGURE_OFFICIAL_DOMAIN",
      title: "先配置品牌官网域名",
      detail:
        "当前品牌未配置官网域名，无法计算官网结果覆盖率，也无法把官网页面与其他页面区分开。建议在品牌设置中补充官网域名（必要时补充官方子域名），然后执行复测。",
      priority: "HIGH",
      evidenceIds: [],
      questionRefs: [],
      caution: "配置官网域名本身不会改变搜索结果，只影响归因口径。",
    });
  }

  if (productQuestions.length > 0) {
    const evidenceIds = productQuestions.flatMap((q) => brandCell(q)?.evidenceIds ?? []).slice(0, 10);
    suggestions.push({
      id: "PRODUCT_QUESTION_MISSING",
      title: `${productQuestions.length} 个产品/功能类问题未发现本品牌`,
      detail:
        "这些问题的有效搜索结果中没有检测到本品牌。可以优先核查对应产品页是否包含与问题意图匹配的事实型内容（产品名称、功能说明、适用场景、常见问题），并确认页面可正常访问与收录。未在搜索结果中发现品牌并不等同于官网存在技术错误。",
      priority: productQuestions.length >= 5 ? "HIGH" : "MEDIUM",
      evidenceIds,
      questionRefs: productQuestions.map((q) => q.questionText).slice(0, 20),
      caution: "搜索排名受多种外部因素影响，上述内容检查只是合理的优化方向，不保证提升。",
    });
  }

  if (thirdPartyDomains.size >= 2 || thirdPartyEvidence.length >= 3) {
    const domains = Array.from(thirdPartyDomains.keys()).slice(0, 5);
    suggestions.push({
      id: "THIRD_PARTY_PAGES",
      title: "多个第三方页面持续提及本品牌",
      detail: `在 ${thirdPartyEvidence.length} 条证据中检测到第三方页面提及品牌，来源包括 ${domains.join("、")}。建议核验这些页面的信息准确性（产品名称、功能、价格等），并评估是否需要补充官方资料，便于外部引用到准确信息。`,
      priority: "MEDIUM",
      evidenceIds: thirdPartyEvidence.map((ev) => ev.id).slice(0, 12),
      questionRefs: [],
      caution: "第三方页面内容由外部站点控制，平台无法直接修改；建议通过官方资料与沟通渠道补充事实。",
    });
  }

  if (comparison) {
    const declined = comparison.questions.declined.length;
    const improved = comparison.questions.improved.length;
    if (declined > 0 || improved > 0) {
      suggestions.push({
        id: "ROUND_VARIATION",
        title: improved > 0 || declined > 0 ? `两轮之间有 ${improved} 个问题提升、${declined} 个问题下降` : "两轮结果出现变化",
        detail:
          "两轮共同问题的品牌出现状态存在变化。单轮变化可能来自搜索索引更新、排序波动或外部内容变化，建议在条件一致的前提下增加复测轮次，并记录内容修改事件，再判断变化是否稳定。",
        priority: "MEDIUM",
        evidenceIds: [...comparison.questions.improved, ...comparison.questions.declined]
          .flatMap((q) => q.retestEvidenceIds)
          .slice(0, 10),
        questionRefs: [...comparison.questions.improved, ...comparison.questions.declined]
          .map((q) => q.questionText)
          .slice(0, 10),
        caution: "前后相关不等于因果关系，不能把单轮变化归因于某次优化。",
      });
    }
    if (!comparison.comparable) {
      suggestions.push({
        id: "INSUFFICIENT_COMPARABLE",
        title: "两轮之间缺少可直接比较的问题",
        detail:
          "两轮任务没有共同的有效问题（可能因失败、空结果或问题集版本变化）。建议先修复失败问题、统一问题集版本后再复测。",
        priority: "HIGH",
        evidenceIds: [],
        questionRefs: comparison.questions.uncomparable.map((q) => q.questionText).slice(0, 10),
        caution: "在补齐可比样本之前，不建议对指标变化下结论。",
      });
    }
  }

  if (dataset.counts.validQuestions > 0 && dataset.counts.validQuestions < 5) {
    suggestions.push({
      id: "LOW_SAMPLE",
      title: "有效样本不足，先补齐样本",
      detail: `本次只有 ${dataset.counts.validQuestions} 个有效问题（成功且返回结果）。建议增加问题数量或在条件一致的情况下多执行一轮采集，再评估指标。`,
      priority: "HIGH",
      evidenceIds: [],
      questionRefs: [],
      caution: "样本不足时不要基于单轮结果做确定性判断。",
    });
  }

  if (needsReview.length > 0) {
    suggestions.push({
      id: "PENDING_REVIEW",
      title: `${needsReview.length} 条证据需要人工复核`,
      detail:
        "部分证据的页面类型或品牌匹配处于待复核状态（例如短别名匹配、页面类型无法可靠识别）。建议在证据详情中确认或驳回，复核结果会记录操作人和时间。",
      priority: "MEDIUM",
      evidenceIds: needsReview.map((ev) => ev.id).slice(0, 20),
      questionRefs: [],
      caution: "待复核证据当前不计入「已确认提及」。",
    });
  }

  if (questionsWithBrand.length < questionsWithoutBrand.length && dataset.counts.validQuestions >= 5) {
    suggestions.push({
      id: "BRAND_COVERAGE_GAP",
      title: "品牌在部分有效问题中未被发现",
      detail: `在 ${dataset.counts.validQuestions} 个有效问题中，${questionsWithBrand.length} 个问题发现了本品牌。建议优先检查未发现问题所涉及的产品/场景页面，并参考同问题下竞品或第三方页面的信息结构。`,
      priority: "MEDIUM",
      evidenceIds: questionsWithoutBrand.flatMap((q) => brandCell(q)?.evidenceIds ?? []).slice(0, 10),
      questionRefs: questionsWithoutBrand.map((q) => q.questionText).slice(0, 20),
      caution: "未发现品牌可能来自搜索结果覆盖不足，不能直接推断为官网技术问题。",
    });
  }

  if (comparison && comparison.volatility.rounds < 2) {
    suggestions.push({
      id: "INCREASE_RETESTS",
      title: "增加复测轮次以观察波动",
      detail:
        "目前可用历史轮次不足以估计波动范围。建议在相同问题集版本、相同采集参数下至少完成 2 轮复测，再做趋势判断。",
      priority: "LOW",
      evidenceIds: [],
      questionRefs: [],
      caution: "重复采集存在时间相关性，不能把多轮结果当作独立样本计算置信区间。",
    });
  }

  return suggestions.slice(0, 10);
}

export interface CreateCollectionReportInput {
  taskId: string;
  /** 可选：与该任务进行比较的基线任务（通常为上一轮） */
  compareTaskId?: string;
  title?: string;
}

export async function createCollectionReport(
  workspaceId: string,
  userId: string,
  input: CreateCollectionReportInput
) {
  const dataset = await buildRoundDataset(workspaceId, input.taskId);
  if (dataset.task.status === "QUEUED" || dataset.task.status === "RUNNING") {
    throw new CollectionReportError("TASK_RUNNING", "任务尚未执行完成，无法生成报告");
  }
  if (dataset.counts.totalQuestions === 0) {
    throw new CollectionReportError("NO_QUESTIONS", "任务没有问题记录，无法生成报告");
  }
  if (dataset.task.isMock) {
    const { env } = await import("@/lib/env");
    if (!env.allowMockReports) {
      throw new CollectionReportError(
        "MOCK_TASK",
        "该任务为模拟模式，没有真实搜索证据，不能生成可信分析报告。请使用真实任务。"
      );
    }
  }

  const questionSet = dataset.task.questionSetId
    ? await prisma.questionSet.findFirst({
        where: { id: dataset.task.questionSetId, workspaceId },
        select: { id: true, name: true },
      })
    : null;

  let comparison: ComparisonResult | null = null;
  const baselineTaskId = input.compareTaskId ?? dataset.task.baselineTaskId ?? undefined;
  if (baselineTaskId) {
    try {
      comparison = await compareTaskRounds(workspaceId, baselineTaskId, input.taskId);
    } catch (error) {
      if (error instanceof ComparisonError) throw new CollectionReportError(error.code, error.message);
      throw error;
    }
  }

  // 确保存在采集快照（失败不阻塞报告；报告中会标注快照状态）
  try {
    await createTaskSnapshot(workspaceId, input.taskId, { kind: "COLLECTION", createdById: userId });
  } catch (error) {
    console.error("[report] 创建采集快照失败:", error instanceof Error ? error.message : error);
  }
  const snapshots = await prisma.analysisSnapshot.findMany({
    where: {
      workspaceId,
      taskId: { in: Array.from(new Set([input.taskId, ...(baselineTaskId ? [baselineTaskId] : [])])) },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, taskId: true, kind: true, ruleVersion: true, createdAt: true },
  });

  const taskRecord = await prisma.searchTask.findFirst({
    where: { id: input.taskId, workspaceId },
    select: { failureReason: true },
  });

  const dataWindowFrom = dataset.task.startedAt ?? dataset.task.createdAt;
  const dataWindowTo = dataset.task.finishedAt ?? new Date().toISOString();
  const started = dataset.task.startedAt ? new Date(dataset.task.startedAt).getTime() : null;
  const finished = dataset.task.finishedAt ? new Date(dataset.task.finishedAt).getTime() : null;
  const durationMs = started !== null && finished !== null ? Math.max(0, finished - started) : null;

  const reportTitle = (input.title?.trim() || `${dataset.brand?.name ?? "品牌"} GEO 搜索证据分析报告`).slice(0, 150);

  const snapshot: CollectionReportSnapshot = {
    schemaVersion: COLLECTION_REPORT_SCHEMA,
    reportTitle,
    generatedAt: new Date().toISOString(),
    dataVersion: {
      metricsVersion: METRICS_VERSION,
      evidenceRuleVersion: EVIDENCE_RULE_VERSION,
      urlNormalizationVersion: URL_NORMALIZATION_VERSION,
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      reportedRuleVersion: snapshotRuleVersion(dataset),
      comparisonVersion: COMPARISON_VERSION,
      snapshotIds: snapshots.map((s) => ({
        id: s.id,
        taskId: s.taskId,
        kind: s.kind,
        ruleVersion: s.ruleVersion,
        createdAt: s.createdAt.toISOString(),
      })),
    },
    brand: dataset.brand
      ? {
          id: dataset.brand.id,
          name: dataset.brand.name,
          websiteDomain: dataset.brand.websiteDomain,
          aliases: dataset.brand.aliases,
          officialSubdomains: dataset.brand.officialSubdomains,
          products: dataset.brand.products,
        }
      : null,
    competitors: dataset.competitors.map((c) => ({
      id: c.id,
      name: c.name,
      websiteDomain: c.websiteDomain,
    })),
    task: {
      id: dataset.task.id,
      name: dataset.task.name,
      status: dataset.task.status,
      executionMode: dataset.task.executionMode,
      provider: dataset.task.provider,
      source: dataset.task.source,
      startedAt: dataset.task.startedAt,
      finishedAt: dataset.task.finishedAt,
      createdAt: dataset.task.createdAt,
      questionSetId: dataset.task.questionSetId,
      questionSetVersionId: dataset.task.questionSetVersionId,
      questionSetVersion: dataset.task.questionSetVersion,
      questionSetName: questionSet?.name ?? null,
      baselineTaskId: dataset.task.baselineTaskId,
      failureReason: taskRecord?.failureReason ?? null,
      params: dataset.task.params,
    },
    collection: {
      totalQuestions: dataset.counts.totalQuestions,
      successItems: dataset.counts.successItems,
      failedItems: dataset.counts.failedItems,
      emptyItems: dataset.counts.emptyItems,
      cancelledItems: dataset.counts.cancelledItems,
      notExecutedItems: dataset.counts.notExecutedItems,
      parseErrorItems: dataset.counts.parseErrorItems,
      validQuestions: dataset.counts.validQuestions,
      successRate:
        dataset.counts.totalQuestions > 0 ? dataset.counts.successItems / dataset.counts.totalQuestions : null,
      dataWindowFrom,
      dataWindowTo,
      durationMs,
      isMock: dataset.task.isMock,
    },
    metrics: dataset.metrics,
    matrix: { entities: dataset.entities, questions: dataset.questions },
    officialCoverage: buildOfficialCoverage(dataset),
    pageTypeDistribution: dataset.pageTypeDistribution,
    representativeEvidence: selectRepresentativeEvidence(dataset),
    comparison,
    volatility: comparison?.volatility ?? null,
    optimizationEvents: comparison?.optimizationEvents ?? [],
    limitations: [
      ...dataset.limitations,
      ...(comparison?.limitations ?? []),
      ...(dataset.task.isMock ? ["本报告基于模拟数据（MOCK），仅用于流程验证，不代表真实搜索表现。"] : []),
      "报告中的指标由服务端确定性代码计算；未使用大模型生成数值。",
    ],
    suggestions: buildSuggestions(dataset, comparison),
    methodology: [
      `指标版本 ${METRICS_VERSION}；证据规则 ${EVIDENCE_RULE_VERSION}；URL 规范化 ${URL_NORMALIZATION_VERSION}；快照结构 ${SNAPSHOT_SCHEMA_VERSION}。`,
      "有效问题 = 执行成功且至少返回 1 条结果的问题。失败、取消、空结果与未执行问题不计入任何比例的分母，单独列出。",
      "品牌提及问题率分母 = 有效问题数；同一问题返回多个同品牌页面只计 1 次；待复核证据不计入已确认提及。",
      "官网结果覆盖率分母 = 有效问题数；官网归属按规范化域名（含已登记官方子域）判定，不按字符串包含判断。",
      "第三方页面覆盖率分母 = 有效问题数；仅统计非官网页面提及品牌的问题。",
      "页面类型分布分母 = 品牌相关证据按规范化 URL 去重后的页面数；页面类型由可解释规则产生，可人工修正。",
      "两轮比较同时提供各自总体指标与共同可比问题子集指标；共同子集指标使用相同分母。",
      "波动分析仅展示观测到的最大值/最小值范围，不是置信区间；重复采集可能存在时间相关性。",
      "原始搜索结果保存在 SearchResult / RawSearchResponse；本报告只保存生成时快照，不被后续数据修改。",
    ],
  };

  const markdown = renderCollectionMarkdown(snapshot);
  const existingVersionCount = await prisma.report.count({
    where: { workspaceId, kind: comparison ? "COMPARISON" : "SEARCH_EVIDENCE", searchTaskId: input.taskId },
  });

  const report = await prisma.report.create({
    data: {
      workspaceId,
      kind: comparison ? "COMPARISON" : "SEARCH_EVIDENCE",
      searchTaskId: input.taskId,
      baselineTaskId: comparison?.baseline.taskId,
      retestTaskId: comparison?.retest.taskId,
      brandId: dataset.brand?.id,
      title: reportTitle,
      version: existingVersionCount + 1,
      snapshot: snapshot as never,
      markdown,
      dataWindowFrom: new Date(dataWindowFrom),
      dataWindowTo: new Date(dataWindowTo),
      createdById: userId,
    },
  });
  await writeAuditLog({
    workspaceId,
    userId,
    action: "SEARCH_REPORT_CREATED",
    targetType: "Report",
    targetId: report.id,
    metadata: {
      taskId: input.taskId,
      compareTaskId: baselineTaskId ?? null,
      ruleVersion: snapshot.dataVersion.reportedRuleVersion,
    },
  });
  return report;
}

export function isCollectionReportSnapshot(value: unknown): value is CollectionReportSnapshot {
  if (!value || typeof value !== "object") return false;
  return (value as { schemaVersion?: unknown }).schemaVersion === COLLECTION_REPORT_SCHEMA;
}

export function getCollectionSnapshot(report: Report): CollectionReportSnapshot {
  return report.snapshot as unknown as CollectionReportSnapshot;
}

function matrixCellText(snapshot: CollectionReportSnapshot, question: MatrixQuestion, entityKey: string): string {
  const cell = question.cells.find((c) => c.entityKey === entityKey);
  if (!cell) return "—";
  return matrixCellStateLabel(cell.state as never);
}

export function renderCollectionMarkdown(snapshot: CollectionReportSnapshot): string {
  const lines: string[] = [];
  lines.push(`# ${snapshot.reportTitle}`);
  lines.push("");
  lines.push("## 1. 报告基本信息");
  lines.push("");
  lines.push(`- 报告生成时间：${new Date(snapshot.generatedAt).toLocaleString("zh-CN", { hour12: false })}`);
  lines.push(`- 数据版本：${snapshot.dataVersion.reportedRuleVersion}`);
  lines.push(`- 指标版本 / 证据规则：${snapshot.dataVersion.metricsVersion} / ${snapshot.dataVersion.evidenceRuleVersion}`);
  lines.push(`- 任务：${snapshot.task.name}（${snapshot.task.id}）`);
  lines.push(`- 任务状态：${snapshot.task.status}；执行模式：${snapshot.task.executionMode === "MOCK" ? "模拟" : "真实"}`);
  lines.push(`- 采集窗口：${snapshot.collection.dataWindowFrom.slice(0, 19).replace("T", " ")} ~ ${snapshot.collection.dataWindowTo.slice(0, 19).replace("T", " ")}`);
  lines.push("");
  lines.push("## 2. 目标品牌与竞品");
  lines.push("");
  lines.push(`- 目标品牌：${snapshot.brand?.name ?? "未指定"}${snapshot.brand?.websiteDomain ? `（官网：${snapshot.brand.websiteDomain}）` : ""}`);
  if (snapshot.brand?.officialSubdomains.length) lines.push(`- 官方子域名：${snapshot.brand.officialSubdomains.join("、")}`);
  lines.push(
    `- 竞品：${snapshot.competitors.length > 0 ? snapshot.competitors.map((c) => `${c.name}${c.websiteDomain ? `（${c.websiteDomain}）` : ""}`).join("、") : "未配置"}`
  );
  lines.push("");
  lines.push("## 3. 采集时间范围与任务");
  lines.push("");
  lines.push(`- 任务创建：${snapshot.task.createdAt.slice(0, 19).replace("T", " ")}`);
  lines.push(`- 开始执行：${snapshot.task.startedAt?.slice(0, 19).replace("T", " ") ?? "—"}`);
  lines.push(`- 完成时间：${snapshot.task.finishedAt?.slice(0, 19).replace("T", " ") ?? "—"}`);
  lines.push(`- 任务耗时：${snapshot.collection.durationMs === null ? "—" : `${Math.round(snapshot.collection.durationMs / 1000)} 秒`}`);
  lines.push("");
  lines.push("## 4. 问题集及版本");
  lines.push("");
  lines.push(`- 问题集：${snapshot.task.questionSetName ?? "—"}（${snapshot.task.questionSetId ?? "未关联"}）`);
  lines.push(`- 问题集版本：v${snapshot.task.questionSetVersion ?? "未知"}`);
  lines.push(`- 问题数：${snapshot.collection.totalQuestions}`);
  lines.push("");
  lines.push("## 5. 采集成功率与有效样本");
  lines.push("");
  lines.push(`- 请求问题数：${snapshot.collection.totalQuestions}`);
  lines.push(`- 成功：${snapshot.collection.successItems}；失败：${snapshot.collection.failedItems}；取消：${snapshot.collection.cancelledItems}`);
  lines.push(`- 空结果：${snapshot.collection.emptyItems}；部分解析异常：${snapshot.collection.parseErrorItems}；未执行：${snapshot.collection.notExecutedItems}`);
  lines.push(`- 成功率：${PERCENT(snapshot.collection.successRate)}（成功问题数 ÷ 问题总数）`);
  lines.push(`- 有效问题（分母）：${snapshot.collection.validQuestions}（成功且至少返回 1 条结果）`);
  lines.push("");
  lines.push("## 6. 核心指标及统计口径");
  lines.push("");
  lines.push("| 指标 | 数值 | 分子 / 分母 | 样本提示 | 口径 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const metric of snapshot.metrics) {
    if (metric.key === "page_type_distribution") continue;
    const value = metric.notConfigured ? "未配置/不可计算" : metric.insufficient ? "样本不足/不可计算" : PERCENT(metric.value);
    const sampleHint = metric.notConfigured ? "未配置官网域名" : metric.insufficient ? "无有效样本" : metric.smallSample ? "样本 < 5" : "正常";
    lines.push(
      `| ${escapeMarkdownCell(metric.label)} | ${value} | ${metric.numerator} / ${metric.denominator} | ${sampleHint} | ${escapeMarkdownCell(metric.definition)} |`
    );
  }
  lines.push("");
  lines.push("## 7. 品牌问题矩阵");
  lines.push("");
  const header = ["问题", "类别", "问题状态", ...snapshot.matrix.entities.map((e) => e.name)];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const q of snapshot.matrix.questions) {
    lines.push(
      `| ${escapeMarkdownCell(q.questionText)} | ${escapeMarkdownCell(q.category)} | ${matrixCellStateLabel(q.state as never)} | ${snapshot.matrix.entities
        .map((e) => escapeMarkdownCell(matrixCellText(snapshot, q, e.key)))
        .join(" | ")} |`
    );
  }
  lines.push("");
  lines.push("## 8. 官网页面覆盖情况");
  lines.push("");
  lines.push(`- 官网域名：${snapshot.officialCoverage.websiteDomain ?? "未配置"}`);
  lines.push(`- 有官网页面的有效问题：${snapshot.officialCoverage.questionsWithOfficialPage} / ${snapshot.collection.validQuestions}`);
  lines.push(`- 去重后的官网页面：${snapshot.officialCoverage.officialPageCount}`);
  if (snapshot.officialCoverage.officialPages.length > 0) {
    lines.push("");
    lines.push("| 页面 | 类型 | 链接 |");
    lines.push("| --- | --- | --- |");
    for (const page of snapshot.officialCoverage.officialPages) {
      lines.push(`| ${escapeMarkdownCell(page.title)} | ${page.pageTypeLabel} | ${page.url} |`);
    }
  }
  lines.push("");
  lines.push("## 9. 页面类型分布");
  lines.push("");
  lines.push("| 页面类型 | 页面数 | 占比 |");
  lines.push("| --- | --- | --- |");
  for (const row of snapshot.pageTypeDistribution) {
    lines.push(`| ${row.label} | ${row.count} | ${PERCENT(row.share)} |`);
  }
  lines.push("");
  lines.push("## 10. 代表性证据及来源链接");
  lines.push("");
  if (snapshot.representativeEvidence.length === 0) lines.push("本次没有可展示的品牌/竞品相关证据。");
  for (const ev of snapshot.representativeEvidence) {
    lines.push(`- [${escapeMarkdownCell(ev.title)}](${ev.url})`);
    lines.push(
      `  - 页面类型：${ev.pageTypeLabel}；来源：${ev.sourceRole === "OFFICIAL" ? "官网" : ev.sourceRole === "THIRD_PARTY" ? "第三方" : "未知"}；匹配依据：${ev.matchBasisLabels.join("、") || "—"}`
    );
    lines.push(`  - 问题：${escapeMarkdownCell(ev.questionText)}；采集时间：${ev.collectedAt.slice(0, 19).replace("T", " ")}${ev.requestId ? `；RequestId：${ev.requestId}` : ""}`);
  }
  lines.push("");
  lines.push("## 11. 历史轮次变化");
  lines.push("");
  if (!snapshot.comparison) {
    lines.push("本次报告未关联上一轮任务，因此不包含轮次变化。可在复测后生成对比报告。");
  } else {
    lines.push(`- 基线：${snapshot.comparison.baseline.name}（有效问题 ${snapshot.comparison.baseline.counts.validQuestions}）`);
    lines.push(`- 复测：${snapshot.comparison.retest.name}（有效问题 ${snapshot.comparison.retest.counts.validQuestions}）`);
    lines.push(
      `- 数据来源：${snapshot.comparison.baseline.dataSource === "SNAPSHOT" ? "两轮采集时保存的 COLLECTION 快照" : "当前证据实时计算"}`
    );
    lines.push(`- 共同可比问题：${snapshot.comparison.questions.totalCommon}；一致性：${PERCENT(snapshot.comparison.consistency.sameBrandStatusRate)}`);
    lines.push(`- 条件一致性：品牌 ${snapshot.comparison.conditions.sameBrand ? "一致" : "不一致"}；数据源 ${snapshot.comparison.conditions.sameProvider ? "一致" : "不一致"}；问题集版本 ${snapshot.comparison.conditions.sameQuestionSetVersion ? "一致" : "不一致"}；采集参数 ${snapshot.comparison.conditions.sameCollectParams ? "一致" : "不一致"}`);
    lines.push("");
    lines.push("| 指标 | 基线 | 复测 | 变化 | 共同子集变化 |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const metric of snapshot.comparison.metrics) {
      const common = snapshot.comparison.commonSubset.metrics.find((m) => m.key === metric.key);
      lines.push(
        `| ${metric.label} | ${PERCENT(metric.baseline.value)} | ${PERCENT(metric.retest.value)} | ${metric.delta === null ? "无法计算" : PERCENT(metric.delta)} | ${
          common ? PERCENT(common.delta) : "—"
        } |`
      );
    }
    lines.push("");
    lines.push(`- 新出现页面：${snapshot.comparison.pageDiff.newPages.length}；未再出现页面：${snapshot.comparison.pageDiff.disappearedPages.length}；持续出现页面：${snapshot.comparison.pageDiff.persistedPages.length}`);
    lines.push(`- 无法直接比较的问题：${snapshot.comparison.questions.uncomparable.length}`);
    if (snapshot.comparison.questions.declined.length > 0) {
      lines.push(`- 品牌状态下降的问题：${snapshot.comparison.questions.declined.map((q) => q.questionText).slice(0, 10).join("；")}`);
    }
    if (snapshot.comparison.questions.improved.length > 0) {
      lines.push(`- 品牌状态提升的问题：${snapshot.comparison.questions.improved.map((q) => q.questionText).slice(0, 10).join("；")}`);
    }
  }
  lines.push("");
  lines.push("## 12. 结果波动与数据限制");
  lines.push("");
  if (snapshot.volatility) {
    lines.push(`- ${snapshot.volatility.intervalLabel}：${PERCENT(snapshot.volatility.observedMin)} ~ ${PERCENT(snapshot.volatility.observedMax)}（${snapshot.volatility.rounds} 轮）`);
    lines.push(`- ${snapshot.volatility.note}`);
    lines.push(`- ${snapshot.volatility.independentAssumptionNote}`);
  } else {
    lines.push("- 未积累足够历史轮次，未计算波动范围。");
  }
  for (const item of snapshot.limitations) lines.push(`- ${item}`);
  lines.push("");
  lines.push("## 13. 可执行的优化建议");
  lines.push("");
  if (snapshot.suggestions.length === 0) lines.push("当前没有可执行的规则建议。");
  for (const suggestion of snapshot.suggestions) {
    lines.push(`### ${suggestion.title}`);
    lines.push("");
    lines.push(suggestion.detail);
    lines.push("");
    lines.push(`- 优先级：${suggestion.priority}`);
    if (suggestion.questionRefs.length > 0) lines.push(`- 关联问题：${suggestion.questionRefs.map(escapeMarkdownCell).join("；")}`);
    if (suggestion.evidenceIds.length > 0) lines.push(`- 关联证据：${suggestion.evidenceIds.slice(0, 10).join("、")}`);
    lines.push(`- 注意：${suggestion.caution}`);
    lines.push("");
  }
  lines.push("## 14. 报告生成时间与数据版本");
  lines.push("");
  lines.push(`- 生成时间：${new Date(snapshot.generatedAt).toLocaleString("zh-CN", { hour12: false })}`);
  lines.push(`- 指标版本：${snapshot.dataVersion.metricsVersion}`);
  lines.push(`- 证据规则版本：${snapshot.dataVersion.evidenceRuleVersion}`);
  lines.push(`- URL 规范化版本：${snapshot.dataVersion.urlNormalizationVersion}`);
  lines.push(`- 快照：${snapshot.dataVersion.snapshotIds.map((s) => `${s.kind}(v${s.ruleVersion}, ${s.taskId.slice(0, 8)})`).join("；") || "—"}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("本报告由 GEO Radar 基于真实搜索证据自动生成；指标由确定性代码计算，未使用模型生成数值。");
  return lines.join("\n");
}

function metricTableHtml(snapshot: CollectionReportSnapshot): string {
  const rows = snapshot.metrics
    .filter((m) => m.key !== "page_type_distribution")
    .map(
      (m) => `<tr><td>${escapeHtml(m.label)}</td><td>${m.notConfigured ? "未配置官网" : m.insufficient ? "样本不足/不可计算" : PERCENT(m.value)}</td><td>${m.numerator} / ${m.denominator}</td><td>${m.notConfigured ? "未配置官网域名" : m.insufficient ? "无有效样本" : m.smallSample ? "样本 &lt; 5" : "正常"}</td><td>${escapeHtml(m.definition)}</td></tr>`
    )
    .join("");
  return `<table><thead><tr><th>指标</th><th>数值</th><th>分子 / 分母</th><th>样本提示</th><th>口径</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderCollectionHtml(snapshot: CollectionReportSnapshot): string {
  const matrixHeader = ["问题", "类别", "问题状态", ...snapshot.matrix.entities.map((e) => e.name)]
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join("");
  const matrixRows = snapshot.matrix.questions
    .map(
      (q) =>
        `<tr><td>${escapeHtml(q.questionText)}</td><td>${escapeHtml(q.category)}</td><td>${escapeHtml(matrixCellStateLabel(q.state as never))}</td>${snapshot.matrix.entities
          .map((e) => `<td>${escapeHtml(matrixCellText(snapshot, q, e.key))}</td>`)
          .join("")}</tr>`
    )
    .join("");
  const evidenceRows = snapshot.representativeEvidence
    .map(
      (ev) =>
        `<tr><td><a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(ev.title)}</a></td><td>${escapeHtml(ev.questionText)}</td><td>${escapeHtml(ev.pageTypeLabel)}</td><td>${escapeHtml(
          ev.matchBasisLabels.join("、")
        )}</td><td>${escapeHtml(ev.collectedAt)}</td></tr>`
    )
    .join("");
  const pageRows = snapshot.pageTypeDistribution
    .map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${row.count}</td><td>${PERCENT(row.share)}</td></tr>`)
    .join("");
  const comparisonHtml = snapshot.comparison
    ? `<table><thead><tr><th>指标</th><th>基线</th><th>复测</th><th>变化</th></tr></thead><tbody>${snapshot.comparison.metrics
        .map(
          (m) =>
            `<tr><td>${escapeHtml(m.label)}</td><td>${PERCENT(m.baseline.value)}</td><td>${PERCENT(m.retest.value)}</td><td>${m.delta === null ? "无法计算" : PERCENT(m.delta)}</td></tr>`
        )
        .join("")}</tbody></table><p>共同可比问题：${snapshot.comparison.questions.totalCommon}；一致性：${PERCENT(
        snapshot.comparison.consistency.sameBrandStatusRate
      )}。${escapeHtml(snapshot.comparison.disclaimer)}</p>`
    : "<p>本次报告未关联上一轮任务，不包含轮次变化。</p>";
  const suggestionsHtml = snapshot.suggestions
    .map(
      (s) =>
        `<div class="suggestion"><h3>${escapeHtml(s.title)}</h3><p>${escapeHtml(s.detail)}</p><p class="muted">优先级：${s.priority}；注意：${escapeHtml(
          s.caution
        )}</p></div>`
    )
    .join("");
  const limitationsHtml = snapshot.limitations.map((l) => `<li>${escapeHtml(l)}</li>`).join("");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(snapshot.reportTitle)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937;background:#f6f8fb;margin:0;padding:32px}
main{max-width:1040px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:32px}
h1{font-size:24px;margin:0 0 4px} h2{font-size:18px;margin-top:30px;border-bottom:1px solid #eef1f5;padding-bottom:8px} h3{font-size:15px;margin:18px 0 6px}
p,li,td,th{font-size:13px;line-height:1.7} .muted{color:#6b7280}
table{width:100%;border-collapse:collapse;margin:10px 0} th,td{border:1px solid #e5e7eb;padding:8px;text-align:left;vertical-align:top}
th{background:#f8fafc;font-weight:600} a{color:#2563eb;text-decoration:none} a:hover{text-decoration:underline}
.suggestion{border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin:10px 0;background:#fbfdff}
.badge{display:inline-block;border:1px solid #d1d5db;border-radius:999px;padding:2px 8px;font-size:11px;color:#4b5563}
footer{margin-top:28px;color:#6b7280;font-size:12px}
@media print{body{background:#fff;padding:0}main{border:none;border-radius:0}}
</style></head><body><main>
<h1>${escapeHtml(snapshot.reportTitle)}</h1>
<p class="muted">生成时间：${escapeHtml(snapshot.generatedAt)} · 任务：${escapeHtml(snapshot.task.name)} · 数据版本：${escapeHtml(
    snapshot.dataVersion.reportedRuleVersion
  )}</p>
<h2>1. 报告基本信息</h2><p>任务状态：${escapeHtml(snapshot.task.status)}；执行模式：${snapshot.task.executionMode === "MOCK" ? "模拟" : "真实"}；数据源：${escapeHtml(
    snapshot.task.provider
  )}</p>
<h2>2. 目标品牌与竞品</h2><p>目标品牌：${escapeHtml(snapshot.brand?.name ?? "未指定")}${
    snapshot.brand?.websiteDomain ? `（${escapeHtml(snapshot.brand.websiteDomain)}）` : ""
  }</p><p>竞品：${escapeHtml(snapshot.competitors.map((c) => c.name).join("、") || "未配置")}</p>
<h2>3. 采集时间范围</h2><p>${escapeHtml(snapshot.collection.dataWindowFrom)} ~ ${escapeHtml(snapshot.collection.dataWindowTo)}</p>
<h2>4. 问题集及版本</h2><p>${escapeHtml(snapshot.task.questionSetName ?? "—")} · v${snapshot.task.questionSetVersion ?? "未知"} · 问题数 ${snapshot.collection.totalQuestions}</p>
<h2>5. 采集成功率与有效样本</h2><p>成功 ${snapshot.collection.successItems}；失败 ${snapshot.collection.failedItems}；空结果 ${snapshot.collection.emptyItems}；取消 ${
    snapshot.collection.cancelledItems
  }；未执行 ${snapshot.collection.notExecutedItems}；解析异常 ${snapshot.collection.parseErrorItems}</p><p>成功率：${PERCENT(
    snapshot.collection.successRate
  )}；有效问题（分母）：${snapshot.collection.validQuestions}</p>
<h2>6. 核心指标及统计口径</h2>${metricTableHtml(snapshot)}
<h2>7. 品牌问题矩阵</h2><table><thead><tr>${matrixHeader}</tr></thead><tbody>${matrixRows}</tbody></table>
<h2>8. 官网页面覆盖情况</h2><p>官网：${escapeHtml(snapshot.officialCoverage.websiteDomain ?? "未配置")}；有官网页面的问题 ${snapshot.officialCoverage.questionsWithOfficialPage} / ${
    snapshot.collection.validQuestions
  }；去重页面 ${snapshot.officialCoverage.officialPageCount}</p>
<h2>9. 页面类型分布</h2><table><thead><tr><th>页面类型</th><th>页面数</th><th>占比</th></tr></thead><tbody>${pageRows}</tbody></table>
<h2>10. 代表性证据及来源链接</h2><table><thead><tr><th>标题 / 链接</th><th>问题</th><th>页面类型</th><th>匹配依据</th><th>采集时间</th></tr></thead><tbody>${evidenceRows}</tbody></table>
<h2>11. 历史轮次变化</h2>${comparisonHtml}
<h2>12. 结果波动与数据限制</h2>${
    snapshot.volatility
      ? `<p>${escapeHtml(snapshot.volatility.intervalLabel)}：${PERCENT(snapshot.volatility.observedMin)} ~ ${PERCENT(
          snapshot.volatility.observedMax
        )}（${snapshot.volatility.rounds} 轮）。${escapeHtml(snapshot.volatility.independentAssumptionNote)}</p>`
      : "<p>历史轮次不足，未计算波动范围。</p>"
  }<ul>${limitationsHtml}</ul>
<h2>13. 可执行的优化建议</h2>${suggestionsHtml}
<h2>14. 报告生成时间与数据版本</h2><p>指标版本 ${escapeHtml(snapshot.dataVersion.metricsVersion)}；证据规则 ${escapeHtml(
    snapshot.dataVersion.evidenceRuleVersion
  )}；URL 规范化 ${escapeHtml(snapshot.dataVersion.urlNormalizationVersion)}</p>
<footer>本报告由 GEO Radar 基于真实搜索证据自动生成；指标由确定性代码计算，未使用模型生成数值。报告为生成时快照。</footer>
</main></body></html>`;
}

export function renderCollectionMetricsCsv(snapshot: CollectionReportSnapshot): string {
  const rows: string[][] = [
    ["metric_key", "label", "value", "numerator", "denominator", "formula_version", "insufficient", "small_sample", "definition", "sample_scope", "notes"],
  ];
  for (const m of snapshot.metrics) {
    rows.push([
      m.key,
      m.label,
      m.value === null ? "" : String(m.value),
      String(m.numerator),
      String(m.denominator),
      m.formulaVersion,
      m.insufficient ? "true" : "false",
      m.smallSample ? "true" : "false",
      m.definition,
      m.sampleScope,
      m.notes,
    ]);
  }
  return serializeCsvRows(rows);
}

export function renderCollectionQuestionsCsv(snapshot: CollectionReportSnapshot): string {
  const brandEntity = snapshot.matrix.entities.find((e) => e.kind === "BRAND");
  const rows: string[][] = [
    ["question", "category", "item_status", "overall_state", "brand_state", "brand_found", "official_page_found", "third_party_found", "page_count", "evidence_count", "needs_review", "result_count", "parse_error_count"],
  ];
  for (const q of snapshot.matrix.questions) {
    const cell = brandEntity ? q.cells.find((c) => c.entityKey === brandEntity.key) : undefined;
    rows.push([
      q.questionText,
      q.category,
      q.itemStatus,
      q.state,
      cell?.state ?? "",
      cell?.found ? "true" : "false",
      cell?.officialPageFound ? "true" : "false",
      cell?.thirdPartyPageFound ? "true" : "false",
      String(cell?.pageCount ?? 0),
      String(cell?.evidenceCount ?? 0),
      cell?.needsReview ? "true" : "false",
      String(q.resultCount),
      String(q.parseErrorCount),
    ]);
  }
  return serializeCsvRows(rows);
}

export function renderCollectionEvidenceCsv(snapshot: CollectionReportSnapshot): string {
  const rows: string[][] = [
    ["evidence_id", "question", "title", "url", "domain", "page_type", "source_role", "mention_status", "match_basis", "competitor_matches", "collected_at", "request_id"],
  ];
  for (const ev of snapshot.representativeEvidence) {
    rows.push([
      ev.id,
      ev.questionText,
      ev.title,
      ev.url,
      ev.domain ?? "",
      ev.pageTypeLabel,
      ev.sourceRole,
      ev.mentionStatus,
      ev.matchBasis.join("|"),
      ev.competitorMatches.join("|"),
      ev.collectedAt,
      ev.requestId ?? "",
    ]);
  }
  return serializeCsvRows(rows);
}

function serializeCsvRows(rows: string[][]): string {
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return rows.map((row) => row.map(escape).join(",")).join("\n") + "\n";
}
