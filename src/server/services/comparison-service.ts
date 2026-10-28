import { prisma } from "@/server/db/client";
import type { RoundDataset, RoundMetric } from "./matrix-service";
import { buildRoundDataset } from "./matrix-service";
import { getSnapshotRoundDataset } from "./snapshot-service";
import { pageKeyOf } from "@/lib/url-normalization";
import { pageTypeLabel } from "./matrix-service";

/**
 * 两轮采集比较与波动分析。
 * - 所有数字来自真实任务/证据；失败与空结果单独展示，不当作「品牌未出现」。
 * - 提供总体指标（各自分母）与共同可比问题子集指标（同分母）。
 * - 「观测区间」是最大值/最小值范围，不是置信区间；不对独立性做未经验证的假设。
 * - 前后相关不等于因果。
 */

export const COMPARISON_VERSION = "comparison-v1";

export class ComparisonError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export interface ComparisonMetricRow {
  key: string;
  label: string;
  formulaVersion: string;
  definition: string;
  baseline: { value: number | null; numerator: number; denominator: number; insufficient: boolean; smallSample: boolean; notConfigured?: boolean };
  retest: { value: number | null; numerator: number; denominator: number; insufficient: boolean; smallSample: boolean; notConfigured?: boolean };
  delta: number | null;
  relativeChange: number | null;
  note: string | null;
}

export interface CommonSubsetMetric {
  key: string;
  label: string;
  baseline: { numerator: number; denominator: number; value: number | null };
  retest: { numerator: number; denominator: number; value: number | null };
  delta: number | null;
}

export interface QuestionChange {
  key: string;
  questionId: string | null;
  questionText: string;
  category: string;
  baselineState: string;
  retestState: string;
  change: "IMPROVED" | "DECLINED" | "UNCHANGED" | "NEWLY_REVIEW" | "UNCOMPARABLE";
  baselineEvidenceIds: string[];
  retestEvidenceIds: string[];
  note: string | null;
}

export interface UncomparableQuestion {
  key: string;
  questionId: string | null;
  questionText: string;
  reason: string;
}

export interface PageDiffItem {
  pageKey: string;
  url: string;
  title: string;
  domain: string | null;
  pageType: string;
  pageTypeLabel: string;
  sourceRole: string;
  questions: string[];
  evidenceId: string | null;
}

export interface PageDiff {
  newPages: PageDiffItem[];
  disappearedPages: PageDiffItem[];
  persistedPages: PageDiffItem[];
  scope: string;
  truncated: boolean;
}

export interface RoundSummary {
  taskId: string;
  name: string;
  status: string;
  executionMode: string;
  provider: string;
  questionSetVersion: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  counts: RoundDataset["counts"];
  ruleVersion: string;
  brandName: string | null;
  /** SNAPSHOT = 使用采集时 COLLECTION 快照；LIVE = 当前证据实时计算 */
  dataSource: "SNAPSHOT" | "LIVE";
}

export interface CompareConditions {
  sameBrand: boolean;
  sameProvider: boolean;
  sameExecutionMode: boolean;
  sameQuestionSetVersion: boolean;
  sameCollectParams: boolean;
  sameBrandConfig: boolean;
  parameterDifferences: Array<{ key: string; baseline: unknown; retest: unknown }>;
  warnings: string[];
}

export interface VolatilitySeriesPoint {
  taskId: string;
  name: string;
  finishedAt: string | null;
  brandMentionRate: number | null;
  validQuestions: number;
  failedItems: number;
  emptyItems: number;
}

export interface VolatilitySummary {
  metric: string;
  rounds: number;
  points: VolatilitySeriesPoint[];
  observedMin: number | null;
  observedMax: number | null;
  observedMean: number | null;
  observedRange: number | null;
  /** 明确不是置信区间 */
  intervalLabel: string;
  independentAssumptionNote: string;
  note: string;
}

export interface OptimizationEventView {
  id: string;
  name: string;
  occurredAt: string;
  contentChanged: string | null;
  pageUrls: string[];
  note: string | null;
  relation: string;
}

export interface ComparisonResult {
  version: string;
  baseline: RoundSummary;
  retest: RoundSummary;
  comparable: boolean;
  conditions: CompareConditions;
  metrics: ComparisonMetricRow[];
  commonSubset: {
    comparableQuestions: number;
    baselineValidQuestions: number;
    retestValidQuestions: number;
    metrics: CommonSubsetMetric[];
  };
  questions: {
    improved: QuestionChange[];
    declined: QuestionChange[];
    unchanged: QuestionChange[];
    newlyNeedsReview: QuestionChange[];
    uncomparable: UncomparableQuestion[];
    totalCommon: number;
  };
  pageDiff: PageDiff;
  consistency: {
    comparableQuestions: number;
    sameBrandStatus: number;
    sameBrandStatusRate: number | null;
  };
  dataQuality: {
    baselineMissingRate: number | null;
    retestMissingRate: number | null;
    baselineFailedShare: number | null;
    retestFailedShare: number | null;
    baselineEmptyShare: number | null;
    retestEmptyShare: number | null;
    needsReviewEvidence: { baseline: number; retest: number };
  };
  volatility: VolatilitySummary;
  optimizationEvents: OptimizationEventView[];
  limitations: string[];
  disclaimer: string;
}

function metricOf(dataset: RoundDataset, key: string): RoundMetric | undefined {
  return dataset.metrics.find((m) => m.key === key);
}

function snapshotMetric(m: RoundMetric | undefined): ComparisonMetricRow["baseline"] {
  return {
    value: m?.value ?? null,
    numerator: m?.numerator ?? 0,
    denominator: m?.denominator ?? 0,
    insufficient: m?.insufficient ?? true,
    smallSample: m?.smallSample ?? false,
    ...(m?.notConfigured ? { notConfigured: true } : {}),
  };
}

function deltaOf(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return b - a;
}

function relativeChange(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  if (a === 0) return b === 0 ? 0 : null;
  return (b - a) / Math.abs(a);
}

function questionKeyOf(q: { questionId: string | null; questionText: string }): string {
  return q.questionId ?? `text:${q.questionText.trim().toLowerCase()}`;
}

function isQuestionValid(state: string): boolean {
  return state !== "TASK_FAILED" && state !== "EMPTY" && state !== "NOT_COLLECTED";
}

function brandCellOf(q: RoundDataset["questions"][number]) {
  return q.cells.find((c) => c.entityKey.startsWith("brand:"));
}

interface PageEntry {
  url: string;
  title: string;
  domain: string | null;
  pageType: string;
  sourceRole: string;
  questions: Set<string>;
  evidenceId: string | null;
}

function relatedPages(dataset: RoundDataset): Map<string, PageEntry> {
  const map = new Map<string, PageEntry>();
  const questionTextById = new Map<string, string>();
  for (const q of dataset.questions) {
    if (q.questionId) questionTextById.set(q.questionId, q.questionText);
  }
  for (const ev of dataset.evidence) {
    if (ev.mentionStatus !== "CONFIRMED_BRAND" && !ev.officialDomainMatch) continue;
    const key = pageKeyOf(ev.url);
    const questionText = (ev.questionId ? questionTextById.get(ev.questionId) : null) ?? "（问题文本不可用）";
    const existing = map.get(key);
    if (existing) {
      existing.questions.add(questionText);
      continue;
    }
    map.set(key, {
      url: ev.url,
      title: ev.title,
      domain: ev.domain,
      pageType: ev.pageType,
      sourceRole: ev.sourceRole,
      questions: new Set([questionText]),
      evidenceId: ev.id,
    });
  }
  return map;
}

const PARAM_KEYS = ["maxResults", "mode", "industry", "freshness", "site", "deeplinks"] as const;

function compareParams(a: Record<string, unknown>, b: Record<string, unknown>) {
  const differences: CompareConditions["parameterDifferences"] = [];
  for (const key of PARAM_KEYS) {
    const left = a[key] ?? null;
    const right = b[key] ?? null;
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      differences.push({ key, baseline: left, retest: right });
    }
  }
  return differences;
}

export interface CompareOptions {
  includeSeries?: boolean;
  seriesLimit?: number;
  /** 默认优先使用 COLLECTION 快照；false 时强制实时重算（用于诊断） */
  preferSnapshot?: boolean;
}

export async function compareTaskRounds(
  workspaceId: string,
  baselineTaskId: string,
  retestTaskId: string,
  options: CompareOptions = {}
): Promise<ComparisonResult> {
  if (baselineTaskId === retestTaskId) {
    throw new ComparisonError("SAME_TASK", "不能将同一轮任务与自身比较");
  }
  const [baselineSnapshot, retestSnapshot] = await Promise.all([
    getSnapshotRoundDataset(workspaceId, baselineTaskId, "COLLECTION"),
    getSnapshotRoundDataset(workspaceId, retestTaskId, "COLLECTION"),
  ]);
  const useSnapshots = options.preferSnapshot !== false && Boolean(baselineSnapshot && retestSnapshot);
  const [baseline, retest] = useSnapshots
    ? [baselineSnapshot as RoundDataset, retestSnapshot as RoundDataset]
    : await Promise.all([
        buildRoundDataset(workspaceId, baselineTaskId),
        buildRoundDataset(workspaceId, retestTaskId),
      ]);

  if ((baseline.brand?.id ?? baseline.task.brandId) !== (retest.brand?.id ?? retest.task.brandId)) {
    throw new ComparisonError("BRAND_MISMATCH", "两轮任务关联的品牌不同，无法进行同口径比较");
  }
  if (baseline.task.provider !== retest.task.provider) {
    throw new ComparisonError("PROVIDER_MISMATCH", "两轮任务使用的数据源不同，无法进行同口径比较");
  }
  if (baseline.task.executionMode !== retest.task.executionMode) {
    throw new ComparisonError("MODE_MISMATCH", "两轮任务的执行模式（真实/模拟）不同，无法进行同口径比较");
  }

  const parameterDifferences = compareParams(baseline.task.params, retest.task.params);
  const configOf = (dataset: RoundDataset) => {
    const snapshot = dataset.task.brandSnapshot as
      | { brand?: { name?: string; aliases?: string[]; websiteDomain?: string | null; officialSubdomains?: string[]; products?: string[]; productAliases?: string[] } | null; competitors?: Array<{ name: string; aliases: string[]; websiteDomain: string | null }> }
      | null;
    const brand = snapshot?.brand ?? dataset.brand;
    const competitors = snapshot?.competitors ?? dataset.competitors;
    return JSON.stringify({
      brand: brand
        ? {
            name: brand.name ?? null,
            aliases: [...(brand.aliases ?? [])].sort(),
            websiteDomain: brand.websiteDomain ?? null,
            officialSubdomains: [...(brand.officialSubdomains ?? [])].sort(),
            products: [...(brand.products ?? [])].sort(),
            productAliases: [...(brand.productAliases ?? [])].sort(),
          }
        : null,
      competitors: competitors
        .map((c) => ({ name: c.name, aliases: [...c.aliases].sort(), websiteDomain: c.websiteDomain }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  };
  const conditions: CompareConditions = {
    sameBrand: true,
    sameProvider: true,
    sameExecutionMode: true,
    sameQuestionSetVersion:
      baseline.task.questionSetVersion === retest.task.questionSetVersion &&
      baseline.task.questionSetVersionId === retest.task.questionSetVersionId,
    sameCollectParams: parameterDifferences.length === 0,
    sameBrandConfig: configOf(baseline) === configOf(retest),
    parameterDifferences,
    warnings: [],
  };
  if (!conditions.sameQuestionSetVersion) {
    conditions.warnings.push(
      `两轮使用的问题集版本不同（基线 v${baseline.task.questionSetVersion ?? "未知"}，复测 v${retest.task.questionSetVersion ?? "未知"}），仅对共同问题做变化比较。`
    );
  }
  if (!conditions.sameCollectParams) {
    conditions.warnings.push(
      `两轮采集参数不同（${parameterDifferences.map((d) => d.key).join("、")}），结果差异可能部分来自采集条件。`
    );
  }
  if (!conditions.sameBrandConfig) {
    conditions.warnings.push("两轮任务创建时的品牌/竞品匹配配置不同，匹配口径可能变化。");
  }
  if (baseline.ruleVersion !== retest.ruleVersion) {
    conditions.warnings.push(
      `两轮分析规则版本不同（基线 ${baseline.ruleVersion}，复测 ${retest.ruleVersion}），指标定义可能不可直接比较。`
    );
  }

  const metricKeys: Array<{ key: string; label: string }> = [
    { key: "brand_mention_question_rate", label: "品牌提及问题率" },
    { key: "official_site_coverage", label: "官网结果覆盖率" },
    { key: "third_party_page_coverage", label: "第三方页面覆盖率" },
  ];
  const metrics: ComparisonMetricRow[] = metricKeys.map(({ key, label }) => {
    const b = metricOf(baseline, key);
    const r = metricOf(retest, key);
    return {
      key,
      label,
      formulaVersion: b?.formulaVersion ?? r?.formulaVersion ?? "unknown",
      definition: b?.definition ?? r?.definition ?? "",
      baseline: snapshotMetric(b),
      retest: snapshotMetric(r),
      delta: deltaOf(b?.value ?? null, r?.value ?? null),
      relativeChange: relativeChange(b?.value ?? null, r?.value ?? null),
      note:
        b?.notConfigured || r?.notConfigured
          ? "品牌未配置官网域名/官方子域，官网结果覆盖率不可计算。"
          : b?.insufficient || r?.insufficient
            ? "至少一轮没有有效样本，无法计算变化。"
            : b?.smallSample || r?.smallSample
              ? "至少一轮有效样本少于 5 个，变化仅作方向性参考。"
              : null,
    };
  });

  // 共同问题
  const baselineByKey = new Map<string, RoundDataset["questions"][number]>();
  for (const q of baseline.questions) baselineByKey.set(questionKeyOf(q), q);
  const retestByKey = new Map<string, RoundDataset["questions"][number]>();
  for (const q of retest.questions) retestByKey.set(questionKeyOf(q), q);

  const allKeys = new Set([...baselineByKey.keys(), ...retestByKey.keys()]);
  const comparableQuestions: Array<{
    key: string;
    baseline: RoundDataset["questions"][number];
    retest: RoundDataset["questions"][number];
    baselineBrand: ReturnType<typeof brandCellOf>;
    retestBrand: ReturnType<typeof brandCellOf>;
  }> = [];
  const uncomparable: UncomparableQuestion[] = [];

  for (const key of allKeys) {
    const b = baselineByKey.get(key);
    const r = retestByKey.get(key);
    if (!b || !r) {
      uncomparable.push({
        key,
        questionId: b?.questionId ?? r?.questionId ?? null,
        questionText: b?.questionText ?? r?.questionText ?? "",
        reason: b ? "仅基线任务包含该问题（复测未覆盖）" : "仅复测任务包含该问题（基线未覆盖）",
      });
      continue;
    }
    if (!isQuestionValid(b.state)) {
      uncomparable.push({
        key,
        questionId: b.questionId,
        questionText: b.questionText,
        reason: `基线该问题不可用：${b.state === "TASK_FAILED" ? "任务失败" : b.state === "EMPTY" ? "结果为空" : "尚未采集"}`,
      });
      continue;
    }
    if (!isQuestionValid(r.state)) {
      uncomparable.push({
        key,
        questionId: r.questionId,
        questionText: r.questionText,
        reason: `复测该问题不可用：${r.state === "TASK_FAILED" ? "任务失败" : r.state === "EMPTY" ? "结果为空" : "尚未采集"}`,
      });
      continue;
    }
    if (b.questionText.trim() !== r.questionText.trim()) {
      uncomparable.push({
        key,
        questionId: b.questionId,
        questionText: r.questionText,
        reason: "同一问题 ID 的问题文本在两次任务中不同，问题表达差异会影响可比性",
      });
      continue;
    }
    comparableQuestions.push({
      key,
      baseline: b,
      retest: r,
      baselineBrand: brandCellOf(b),
      retestBrand: brandCellOf(r),
    });
  }

  const improved: QuestionChange[] = [];
  const declined: QuestionChange[] = [];
  const unchanged: QuestionChange[] = [];
  const newlyNeedsReview: QuestionChange[] = [];
  let sameBrandStatus = 0;

  for (const entry of comparableQuestions) {
    const bFound = entry.baselineBrand?.found === true;
    const rFound = entry.retestBrand?.found === true;
    if (bFound === rFound) sameBrandStatus += 1;
    const baseChange: QuestionChange = {
      key: entry.key,
      questionId: entry.retest.questionId,
      questionText: entry.retest.questionText,
      category: entry.retest.category,
      baselineState: entry.baselineBrand?.state ?? "NOT_FOUND",
      retestState: entry.retestBrand?.state ?? "NOT_FOUND",
      change: "UNCHANGED",
      baselineEvidenceIds: entry.baselineBrand?.evidenceIds ?? [],
      retestEvidenceIds: entry.retestBrand?.evidenceIds ?? [],
      note: null,
    };
    if (!bFound && rFound) {
      improved.push({ ...baseChange, change: "IMPROVED" });
    } else if (bFound && !rFound) {
      if (entry.retestBrand?.state === "NEEDS_REVIEW") {
        newlyNeedsReview.push({ ...baseChange, change: "NEWLY_REVIEW", note: "复测中品牌匹配待人工复核" });
      } else {
        declined.push({ ...baseChange, change: "DECLINED" });
      }
    } else if (entry.retestBrand?.state === "NEEDS_REVIEW") {
      newlyNeedsReview.push({ ...baseChange, change: "NEWLY_REVIEW", note: "复测中品牌匹配待人工复核" });
    } else {
      unchanged.push({ ...baseChange, change: "UNCHANGED" });
    }
  }

  // 共同子集指标（同分母、同指标定义）
  const commonDenominator = comparableQuestions.length;
  const commonCount = (which: "baseline" | "retest", predicate: (cell: NonNullable<ReturnType<typeof brandCellOf>>) => boolean) =>
    comparableQuestions.filter((entry) => {
      const cell = which === "baseline" ? entry.baselineBrand : entry.retestBrand;
      return cell ? predicate(cell) : false;
    }).length;
  const commonSubset: ComparisonResult["commonSubset"] = {
    comparableQuestions: commonDenominator,
    baselineValidQuestions: baseline.counts.validQuestions,
    retestValidQuestions: retest.counts.validQuestions,
    metrics: [
      {
        key: "brand_mention_question_rate",
        label: "品牌提及问题率（共同问题子集）",
        baseline: {
          numerator: commonCount("baseline", (c) => c.found),
          denominator: commonDenominator,
          value: commonDenominator > 0 ? commonCount("baseline", (c) => c.found) / commonDenominator : null,
        },
        retest: {
          numerator: commonCount("retest", (c) => c.found),
          denominator: commonDenominator,
          value: commonDenominator > 0 ? commonCount("retest", (c) => c.found) / commonDenominator : null,
        },
        delta: null,
      },
      {
        key: "official_site_coverage",
        label: "官网结果覆盖率（共同问题子集）",
        baseline: {
          numerator: commonCount("baseline", (c) => c.officialPageFound),
          denominator: commonDenominator,
          value: commonDenominator > 0 ? commonCount("baseline", (c) => c.officialPageFound) / commonDenominator : null,
        },
        retest: {
          numerator: commonCount("retest", (c) => c.officialPageFound),
          denominator: commonDenominator,
          value: commonDenominator > 0 ? commonCount("retest", (c) => c.officialPageFound) / commonDenominator : null,
        },
        delta: null,
      },
      {
        key: "third_party_page_coverage",
        label: "第三方页面覆盖率（共同问题子集）",
        baseline: {
          numerator: commonCount("baseline", (c) => c.thirdPartyPageFound),
          denominator: commonDenominator,
          value: commonDenominator > 0 ? commonCount("baseline", (c) => c.thirdPartyPageFound) / commonDenominator : null,
        },
        retest: {
          numerator: commonCount("retest", (c) => c.thirdPartyPageFound),
          denominator: commonDenominator,
          value: commonDenominator > 0 ? commonCount("retest", (c) => c.thirdPartyPageFound) / commonDenominator : null,
        },
        delta: null,
      },
    ].map((row) => ({
      ...row,
      delta: deltaOf(row.baseline.value, row.retest.value),
    })),
  };

  // 页面变化（品牌相关页面，按规范化 URL 去重）
  const baselinePages = relatedPages(baseline);
  const retestPages = relatedPages(retest);
  const toDiffItem = (key: string, entry: PageEntry): PageDiffItem => ({
    pageKey: key,
    url: entry.url,
    title: entry.title,
    domain: entry.domain,
    pageType: entry.pageType,
    pageTypeLabel: pageTypeLabel(entry.pageType as never),
    sourceRole: entry.sourceRole,
    questions: Array.from(entry.questions),
    evidenceId: entry.evidenceId,
  });
  const newPages: PageDiffItem[] = [];
  const disappearedPages: PageDiffItem[] = [];
  const persistedPages: PageDiffItem[] = [];
  for (const [key, entry] of retestPages) {
    if (baselinePages.has(key)) persistedPages.push(toDiffItem(key, entry));
    else newPages.push(toDiffItem(key, entry));
  }
  for (const [key, entry] of baselinePages) {
    if (!retestPages.has(key)) disappearedPages.push(toDiffItem(key, entry));
  }
  const PAGE_LIMIT = 200;
  const pageDiff: PageDiff = {
    newPages: newPages.slice(0, PAGE_LIMIT),
    disappearedPages: disappearedPages.slice(0, PAGE_LIMIT),
    persistedPages: persistedPages.slice(0, PAGE_LIMIT),
    scope: "品牌相关页面（已被确认提及或官网同站），按规范化 URL 去重；同域名不同路径视为不同页面。",
    truncated:
      newPages.length > PAGE_LIMIT || disappearedPages.length > PAGE_LIMIT || persistedPages.length > PAGE_LIMIT,
  };

  const missingOf = (dataset: RoundDataset) => {
    const total = dataset.counts.totalQuestions;
    const missing = dataset.counts.failedItems + dataset.counts.emptyItems + dataset.counts.cancelledItems;
    return total > 0 ? missing / total : null;
  };
  const shareOf = (dataset: RoundDataset, value: number) =>
    dataset.counts.totalQuestions > 0 ? value / dataset.counts.totalQuestions : null;

  const dataQuality: ComparisonResult["dataQuality"] = {
    baselineMissingRate: missingOf(baseline),
    retestMissingRate: missingOf(retest),
    baselineFailedShare: shareOf(baseline, baseline.counts.failedItems),
    retestFailedShare: shareOf(retest, retest.counts.failedItems),
    baselineEmptyShare: shareOf(baseline, baseline.counts.emptyItems),
    retestEmptyShare: shareOf(retest, retest.counts.emptyItems),
    needsReviewEvidence: {
      baseline: baseline.counts.needsReviewEvidence,
      retest: retest.counts.needsReviewEvidence,
    },
  };

  // 波动序列：同一品牌 + 同一问题集版本的历史轮次（最多 10 轮）
  const seriesPoints: VolatilitySeriesPoint[] = [];
  let seriesTaskCount = 0;
  if (options.includeSeries !== false && baseline.task.brandId) {
    const tasks = await prisma.searchTask.findMany({
      where: {
        workspaceId,
        brandId: baseline.task.brandId,
        executionMode: baseline.task.executionMode,
        status: { in: ["COMPLETED", "PARTIAL_FAILED"] },
        ...(baseline.task.questionSetId ? { questionSetId: baseline.task.questionSetId } : {}),
        ...(baseline.task.questionSetVersion !== null ? { questionSetVersion: baseline.task.questionSetVersion } : {}),
      },
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
      take: Math.min(10, Math.max(2, options.seriesLimit ?? 8)),
      select: { id: true, name: true, finishedAt: true },
    });
    seriesTaskCount = tasks.length;
    for (const task of tasks) {
      try {
        const dataset = task.id === baseline.task.id
          ? baseline
          : task.id === retest.task.id
            ? retest
            : (await getSnapshotRoundDataset(workspaceId, task.id, "COLLECTION")) ??
              (await buildRoundDataset(workspaceId, task.id));
        const metric = metricOf(dataset, "brand_mention_question_rate");
        if (!metric || metric.insufficient) continue;
        seriesPoints.push({
          taskId: dataset.task.id,
          name: dataset.task.name,
          finishedAt: dataset.task.finishedAt,
          brandMentionRate: metric.value,
          validQuestions: metric.denominator,
          failedItems: dataset.counts.failedItems,
          emptyItems: dataset.counts.emptyItems,
        });
      } catch {
        // 历史轮次读取失败不应影响主比较
      }
    }
  }
  const rates = seriesPoints.map((p) => p.brandMentionRate).filter((v): v is number => v !== null);
  const observedMin = rates.length > 0 ? Math.min(...rates) : null;
  const observedMax = rates.length > 0 ? Math.max(...rates) : null;
  const observedMean = rates.length > 0 ? rates.reduce((s, v) => s + v, 0) / rates.length : null;
  const volatility: VolatilitySummary = {
    metric: "品牌提及问题率",
    rounds: seriesPoints.length,
    points: seriesPoints.reverse(),
    observedMin,
    observedMax,
    observedMean,
    observedRange: observedMin !== null && observedMax !== null ? observedMax - observedMin : null,
    intervalLabel: "观测区间（最大值~最小值），不是置信区间",
    independentAssumptionNote:
      "同一品牌在同一时期的重复采集可能受时间相关性影响（搜索索引更新、排序波动、热点事件），不能直接当作独立重复样本。当前版本不提供置信区间。",
    note:
      rates.length < 2
        ? `可用历史轮次不足（当前 ${rates.length} 轮），无法估计波动范围；建议至少完成 2 轮同等条件的复测。`
        : `基于 ${rates.length} 轮同品牌、同问题集版本的采集，仅描述观测到的波动范围；样本量小或时间集中时不代表稳定分布。`,
  };

  // 优化事件（如用户已记录）
  const optimizationEvents = baseline.task.brandId
    ? (
        await prisma.optimizationEvent.findMany({
          where: {
            workspaceId,
            brandId: baseline.task.brandId,
            OR: [
              { baselineTaskId: baseline.task.id },
              { retestTaskId: retest.task.id },
              ...(baseline.task.finishedAt && retest.task.finishedAt
                ? [{ occurredAt: { gte: new Date(baseline.task.finishedAt), lte: new Date(retest.task.finishedAt) } }]
                : []),
            ],
          },
          orderBy: { occurredAt: "asc" },
          take: 50,
        })
      ).map((event) => ({
        id: event.id,
        name: event.name,
        occurredAt: event.occurredAt.toISOString(),
        contentChanged: event.contentChanged,
        pageUrls: event.pageUrls,
        note: event.note,
        relation:
          event.baselineTaskId === baseline.task.id || event.retestTaskId === retest.task.id
            ? "已关联本轮任务"
            : "发生在两轮采集时间之间",
      }))
    : [];

  const limitations: string[] = [];
  if (commonDenominator === 0) limitations.push("两轮任务没有共同可比的问题，无法计算问题级变化。");
  if (commonDenominator > 0 && commonDenominator < 5)
    limitations.push(`共同可比问题仅 ${commonDenominator} 个，变化幅度容易受单个结果影响。`);
  if (uncomparable.length > 0)
    limitations.push(`${uncomparable.length} 个问题无法直接比较（失败、空结果、仅单轮存在或文本变化），已单独列出。`);
  if (!conditions.sameCollectParams) limitations.push("两轮采集参数不完全一致，差异可能部分来自采集条件。");
  if (!conditions.sameQuestionSetVersion) limitations.push("两轮使用的问题集版本不同，问题级比较仅覆盖共同问题。");
  if (!conditions.sameBrandConfig) limitations.push("两轮匹配配置不同，品牌识别口径可能发生变化。");
  if (baseline.task.isMock || retest.task.isMock) limitations.push("至少一轮为模拟模式，结果不可用于真实可见度结论。");
  if (seriesTaskCount < 2) limitations.push("历史轮次不足，无法进行波动分析。");
  if (useSnapshots) {
    limitations.push(
      "比较使用两轮采集时保存的 COLLECTION 快照；后续人工复核或规则变更不会改写这些历史快照中的指标。"
    );
  } else {
    limitations.push(
      "至少一轮缺少可用的 COLLECTION 快照，本次比较使用当前证据实时计算；后续人工复核可能影响该轮指标。"
    );
  }
  limitations.push("本比较只描述两轮真实搜索结果的差异，不证明任何单一优化动作导致变化。");

  return {
    version: COMPARISON_VERSION,
    baseline: {
      taskId: baseline.task.id,
      name: baseline.task.name,
      status: baseline.task.status,
      executionMode: baseline.task.executionMode,
      provider: baseline.task.provider,
      questionSetVersion: baseline.task.questionSetVersion,
      startedAt: baseline.task.startedAt,
      finishedAt: baseline.task.finishedAt,
      counts: baseline.counts,
      ruleVersion: baseline.ruleVersion,
      brandName: baseline.brand?.name ?? null,
      dataSource: useSnapshots ? "SNAPSHOT" : "LIVE",
    },
    retest: {
      taskId: retest.task.id,
      name: retest.task.name,
      status: retest.task.status,
      executionMode: retest.task.executionMode,
      provider: retest.task.provider,
      questionSetVersion: retest.task.questionSetVersion,
      startedAt: retest.task.startedAt,
      finishedAt: retest.task.finishedAt,
      counts: retest.counts,
      ruleVersion: retest.ruleVersion,
      brandName: retest.brand?.name ?? null,
      dataSource: useSnapshots ? "SNAPSHOT" : "LIVE",
    },
    comparable: commonDenominator > 0,
    conditions,
    metrics,
    commonSubset,
    questions: {
      improved,
      declined,
      unchanged,
      newlyNeedsReview,
      uncomparable,
      totalCommon: comparableQuestions.length,
    },
    pageDiff,
    consistency: {
      comparableQuestions: comparableQuestions.length,
      sameBrandStatus,
      sameBrandStatusRate: comparableQuestions.length > 0 ? sameBrandStatus / comparableQuestions.length : null,
    },
    dataQuality,
    volatility,
    optimizationEvents,
    limitations,
    disclaimer:
      "两轮变化仅反映本次可比样本中的差异。搜索引擎索引更新、结果排序、问题表达、采集时间与外部内容变化都可能影响结果；没有对照设计时，不能声称某项优化直接导致指标提升。",
  };
}
