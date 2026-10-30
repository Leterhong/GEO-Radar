import { prisma } from "@/server/db/client";
import type { Evidence, SearchTask, SearchTaskItem } from "@prisma/client";
import { classifyPage, type PageTypeValue } from "@/lib/page-classification";
import { pageKeyOf } from "@/lib/url-normalization";
import { isConfiguredOfficialHost, sameSite } from "@/lib/domain-utils";
import { EVIDENCE_RULE_VERSION } from "./brand-matching";

/**
 * 品牌问题矩阵与服务端统一指标。
 *
 * 统计单元 = 采集任务中的一个问题（SearchTaskItem）。
 * - 有效问题：执行成功且至少返回 1 条结果；失败/取消/空结果不计入分母，单独展示，绝不当作「品牌未出现」。
 * - 同一问题返回多个同品牌页面只计 1 个问题（问题级指标），页面数量单独统计。
 * - 同一页面在同一轮任务中按规范化 URL 去重。
 * - 需要人工复核的证据不算作「已确认提及」，但会单独提示。
 */

export const METRICS_VERSION = "geo-metrics-v2";
export const MIN_RECOMMENDED_SAMPLE = 5;

export type MatrixCellState =
  | "FOUND"
  | "NOT_FOUND"
  | "TASK_FAILED"
  | "EMPTY"
  | "NOT_COLLECTED"
  | "NEEDS_REVIEW";

export type MatrixEntityKind = "BRAND" | "COMPETITOR";

export interface MatrixEntity {
  key: string;
  kind: MatrixEntityKind;
  id: string;
  name: string;
  websiteDomain: string | null;
}

export interface EvidenceView {
  id: string;
  questionId: string | null;
  itemId: string | null;
  title: string;
  url: string;
  normalizedUrl: string | null;
  domain: string | null;
  snippet: string | null;
  publishedAt: string | null;
  requestId: string | null;
  pageType: PageTypeValue;
  pageTypeRule: string | null;
  sourceRole: "OFFICIAL" | "THIRD_PARTY" | "UNKNOWN";
  mentionStatus: string;
  detectionMethod: string;
  brandMatchBasis: string[];
  matchedTerms: string[];
  competitorMatches: string[];
  officialDomainMatch: boolean;
  thirdPartyMention: boolean;
  relevance: string;
  collectedAt: string;
  reviewNote: string | null;
  reviewedAt: string | null;
}

export interface MatrixCell {
  entityKey: string;
  state: MatrixCellState;
  found: boolean;
  officialPageFound: boolean;
  thirdPartyPageFound: boolean;
  pageCount: number;
  evidenceCount: number;
  needsReview: boolean;
  lastCollectedAt: string | null;
  evidenceIds: string[];
  pageUrls: string[];
}

export interface MatrixQuestion {
  key: string;
  itemId: string;
  questionId: string | null;
  questionText: string;
  category: string;
  itemStatus: string;
  state: MatrixCellState;
  resultCount: number;
  parseErrorCount: number;
  executedAt: string | null;
  cells: MatrixCell[];
}

export interface RoundMetric {
  key: string;
  label: string;
  value: number | null;
  numerator: number;
  denominator: number;
  formulaVersion: string;
  definition: string;
  sampleScope: string;
  notes: string;
  insufficient: boolean;
  /** 指标因品牌配置缺失（例如未配置官网域名）而不可计算 */
  notConfigured?: boolean;
  smallSample: boolean;
  sampleStatus: "NO_SAMPLE" | "LOW" | "OK";
  breakdown?: unknown;
}

export interface PageTypeDistributionRow {
  pageType: PageTypeValue;
  label: string;
  count: number;
  share: number | null;
}

export interface RoundCounts {
  totalQuestions: number;
  successItems: number;
  failedItems: number;
  emptyItems: number;
  cancelledItems: number;
  notExecutedItems: number;
  parseErrorItems: number;
  validQuestions: number;
  needsReviewEvidence: number;
  totalEvidence: number;
  uniquePages: number;
}

export interface RoundDataset {
  task: {
    id: string;
    name: string;
    brandId: string | null;
    brandName: string | null;
    executionMode: "REAL" | "MOCK";
    provider: string;
    status: string;
    source: string;
    questionSetId: string | null;
    questionSetVersionId: string | null;
    questionSetVersion: number | null;
    baselineTaskId: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
    params: Record<string, unknown>;
    brandSnapshot: Record<string, unknown> | null;
    isMock: boolean;
  };
  brand: {
    id: string;
    name: string;
    englishName: string | null;
    websiteDomain: string | null;
    aliases: string[];
    officialSubdomains: string[];
    products: string[];
    productAliases: string[];
  } | null;
  competitors: Array<{ id: string; name: string; aliases: string[]; websiteDomain: string | null }>;
  entities: MatrixEntity[];
  questions: MatrixQuestion[];
  /** 本轮全部证据（分析后视图，用于快照/比较） */
  evidence: EvidenceView[];
  metrics: RoundMetric[];
  pageTypeDistribution: PageTypeDistributionRow[];
  counts: RoundCounts;
  ruleVersion: string;
  limitations: string[];
}

const PAGE_TYPE_LABELS: Record<PageTypeValue, string> = {
  OFFICIAL_HOMEPAGE: "官网首页",
  PRODUCT_PAGE: "产品页",
  DOCS_PAGE: "文档/帮助中心",
  BLOG_NEWS: "博客/资讯页",
  THIRD_PARTY_MEDIA: "第三方媒体页",
  REVIEW_PAGE: "测评/软件目录",
  ECOMMERCE_PAGE: "电商/商品页",
  COMMUNITY_FORUM: "社区/论坛页",
  SOCIAL_MEDIA: "社交媒体",
  OTHER: "其他页面",
  UNKNOWN: "未知类型",
};

export function pageTypeLabel(type: PageTypeValue): string {
  return PAGE_TYPE_LABELS[type] ?? type;
}

function iso(date: Date | null | undefined): string | null {
  return date ? new Date(date).toISOString() : null;
}
interface ResolvedEvidence extends EvidenceView {
  rawPageType: string;
}

function legacyBasis(
  evidence: Evidence,
  brand: RoundDataset["brand"],
  officialDomainMatch: boolean,
  competitorMatches: string[]
): string[] {
  const basis: string[] = [];
  if (officialDomainMatch) basis.push("OFFICIAL_DOMAIN");
  const title = (evidence.title ?? "").toLowerCase();
  const snippet = (evidence.snippet ?? "").toLowerCase();
  for (const term of evidence.matchedTerms ?? []) {
    if (term.startsWith("domain:")) continue;
    const lower = term.toLowerCase();
    const kind = brand && lower === brand.name.toLowerCase() ? "NAME" : "ALIAS";
    if (title.includes(lower)) basis.push(`TITLE_${kind}`);
    else if (snippet.includes(lower)) basis.push(`SNIPPET_${kind}`);
  }
  if (basis.length === 0 && evidence.mentionStatus === "CONFIRMED_BRAND") {
    // 早期规则未保存匹配依据：明确标注为旧规则匹配，并建议重算
    basis.push("LEGACY_MATCH");
  }
  if (basis.length === 0) basis.push(competitorMatches.length > 0 ? "COMPETITOR_ONLY" : "NONE");
  return Array.from(new Set(basis));
}

function resolveEvidence(
  evidence: Evidence & { result?: { itemId: string } | null },
  brand: RoundDataset["brand"]
): ResolvedEvidence {
  const storedPageType = evidence.pageType as PageTypeValue;
  const legacy = evidence.sourceRole === "UNKNOWN";
  const classification = legacy
    ? classifyPage({
        url: evidence.url,
        domain: evidence.domain,
        title: evidence.title,
        snippet: evidence.snippet,
        brand: brand ? { websiteDomain: brand.websiteDomain, officialSubdomains: brand.officialSubdomains } : null,
      })
    : null;
  const pageType = (legacy && classification ? (classification.pageType as PageTypeValue) : storedPageType) as PageTypeValue;
  const sourceRole = legacy && classification ? classification.sourceRole : evidence.sourceRole;
  const officialDomainMatch =
    evidence.officialDomainMatch ||
    isConfiguredOfficialHost(evidence.domain, brand?.websiteDomain, brand?.officialSubdomains);
  const thirdPartyMention =
    evidence.thirdPartyMention ||
    (sourceRole === "THIRD_PARTY" && evidence.mentionStatus === "CONFIRMED_BRAND");
  const brandMatchBasis =
    evidence.brandMatchBasis && evidence.brandMatchBasis.length > 0
      ? evidence.brandMatchBasis
      : legacyBasis(evidence, brand, officialDomainMatch, evidence.competitorMatches ?? []);
  return {
    id: evidence.id,
    questionId: evidence.questionId,
    itemId: evidence.result?.itemId ?? null,
    title: evidence.title,
    url: evidence.url,
    normalizedUrl: evidence.normalizedUrl,
    domain: evidence.domain,
    snippet: evidence.snippet,
    publishedAt: evidence.publishedAt,
    requestId: evidence.requestId,
    pageType,
    pageTypeRule: evidence.pageTypeRule ?? classification?.ruleId ?? null,
    sourceRole,
    mentionStatus: evidence.mentionStatus,
    detectionMethod: evidence.detectionMethod,
    brandMatchBasis,
    matchedTerms: evidence.matchedTerms ?? [],
    competitorMatches: evidence.competitorMatches ?? [],
    officialDomainMatch,
    thirdPartyMention,
    relevance: evidence.relevance,
    collectedAt: iso(evidence.collectedAt) as string,
    reviewNote: evidence.reviewNote,
    reviewedAt: iso(evidence.reviewedAt),
    rawPageType: storedPageType,
  };
}

function evidenceBelongsToBrand(ev: ResolvedEvidence): boolean {
  return ev.mentionStatus === "CONFIRMED_BRAND" || ev.officialDomainMatch;
}

function evidenceBelongsToCompetitor(ev: ResolvedEvidence, competitorName: string, competitorDomain: string | null): boolean {
  if (ev.competitorMatches.includes(competitorName)) return true;
  if (competitorDomain && sameSite(ev.domain, competitorDomain)) return true;
  return false;
}

function isEvidenceNeedsReview(ev: ResolvedEvidence): boolean {
  if (ev.mentionStatus !== "PENDING_REVIEW") return false;
  if (ev.matchedTerms.length > 0) return true;
  return ev.brandMatchBasis.some(
    (basis) => basis !== "NONE" && basis !== "COMPETITOR_ONLY"
  );
}

function makeMetric(args: {
  key: string;
  label: string;
  numerator: number;
  denominator: number;
  definition: string;
  sampleScope: string;
  notes: string;
  value?: number | null;
  notConfigured?: boolean;
  breakdown?: unknown;
}): RoundMetric {
  const notConfigured = args.notConfigured === true;
  const insufficient = notConfigured || args.denominator === 0;
  const smallSample = !insufficient && args.denominator < MIN_RECOMMENDED_SAMPLE;
  const value = args.value !== undefined ? args.value : insufficient ? null : args.numerator / args.denominator;
  return {
    key: args.key,
    label: args.label,
    value: notConfigured ? null : value,
    numerator: args.numerator,
    denominator: args.denominator,
    formulaVersion: METRICS_VERSION,
    definition: args.definition,
    sampleScope: args.sampleScope,
    notes: args.notes,
    insufficient,
    ...(notConfigured ? { notConfigured: true } : {}),
    smallSample,
    sampleStatus: insufficient ? "NO_SAMPLE" : smallSample ? "LOW" : "OK",
    ...(args.breakdown !== undefined ? { breakdown: args.breakdown } : {}),
  };
}

export interface MatrixCellView extends MatrixCell {
  stateLabel: string;
}

const CELL_STATE_LABELS: Record<MatrixCellState, string> = {
  FOUND: "已发现",
  NOT_FOUND: "本次未发现",
  TASK_FAILED: "任务失败",
  EMPTY: "结果为空",
  NOT_COLLECTED: "尚未采集",
  NEEDS_REVIEW: "需要复核",
};

export function matrixCellStateLabel(state: MatrixCellState): string {
  return CELL_STATE_LABELS[state] ?? state;
}

function buildCells(
  item: SearchTaskItem,
  itemEvidence: ResolvedEvidence[],
  brand: RoundDataset["brand"],
  competitors: RoundDataset["competitors"],
  entities: MatrixEntity[]
): { cells: MatrixCell[]; questionState: MatrixCellState } {
  const itemFailed = item.status === "FAILED" || item.status === "CANCELLED";
  const itemPending = item.status === "PENDING" || item.status === "RUNNING";
  const itemEmpty = !itemFailed && !itemPending && item.resultCount === 0;

  const baseState: MatrixCellState | null = itemFailed
    ? "TASK_FAILED"
    : itemPending
      ? "NOT_COLLECTED"
      : itemEmpty
        ? "EMPTY"
        : null;

  const cells: MatrixCell[] = entities.map((entity) => {
    if (baseState) {
      return {
        entityKey: entity.key,
        state: baseState,
        found: false,
        officialPageFound: false,
        thirdPartyPageFound: false,
        pageCount: 0,
        evidenceCount: 0,
        needsReview: false,
        lastCollectedAt: null,
        evidenceIds: [],
        pageUrls: [],
      };
    }

    let matched: ResolvedEvidence[] = [];
    let needsReview = false;
    if (entity.kind === "BRAND") {
      matched = itemEvidence.filter((ev) => evidenceBelongsToBrand(ev));
      needsReview = itemEvidence.some((ev) => isEvidenceNeedsReview(ev));
    } else {
      const competitor = competitors.find((c) => c.id === entity.id);
      matched = itemEvidence.filter((ev) =>
        evidenceBelongsToCompetitor(ev, entity.name, competitor?.websiteDomain ?? null)
      );
    }

    const pageKeys = new Set(matched.map((ev) => pageKeyOf(ev.url)));
    const officialPageFound = matched.some((ev) =>
      entity.kind === "BRAND" ? ev.officialDomainMatch : entity.websiteDomain ? sameSite(ev.domain, entity.websiteDomain) : false
    );
    const thirdPartyPageFound = matched.some((ev) =>
      entity.kind === "BRAND"
        ? ev.thirdPartyMention
        : ev.competitorMatches.includes(entity.name) && ev.sourceRole !== "OFFICIAL"
    );
    const found = matched.length > 0;
    const state: MatrixCellState = found ? "FOUND" : needsReview ? "NEEDS_REVIEW" : "NOT_FOUND";
    const lastCollectedAt =
      matched
        .map((ev) => ev.collectedAt)
        .sort()
        .at(-1) ?? null;

    return {
      entityKey: entity.key,
      state,
      found,
      officialPageFound,
      thirdPartyPageFound,
      pageCount: pageKeys.size,
      evidenceCount: matched.length,
      needsReview,
      lastCollectedAt,
      evidenceIds: matched.map((ev) => ev.id),
      pageUrls: Array.from(new Set(matched.map((ev) => ev.url))).slice(0, 20),
    };
  });

  const brandEntityKey = entities.find((e) => e.kind === "BRAND")?.key;
  const brandCell = brandEntityKey ? cells.find((c) => c.entityKey === brandEntityKey) : undefined;
  const questionState: MatrixCellState = baseState
    ? baseState
    : brandCell
      ? brandCell.state
      : cells.some((c) => c.state === "FOUND")
        ? "FOUND"
        : cells.some((c) => c.state === "NEEDS_REVIEW")
          ? "NEEDS_REVIEW"
          : "NOT_FOUND";

  return { cells, questionState };
}

/**
 * 读取一轮采集任务并计算矩阵 + 指标。所有计算发生在服务端。
 */
export async function buildRoundDataset(
  workspaceId: string,
  taskId: string
): Promise<RoundDataset> {
  const task = await prisma.searchTask.findFirst({
    where: { id: taskId, workspaceId },
    include: {
      brand: {
        select: {
          id: true,
          name: true,
          englishName: true,
          websiteDomain: true,
          aliases: true,
          officialSubdomains: true,
          products: true,
          productAliases: true,
        },
      },
      items: { orderBy: { createdAt: "asc" }, include: { question: { select: { category: true } } } },
    },
  });
  if (!task) throw new Error("任务不存在或不属于当前工作空间");

  const competitors = task.brandId
    ? await prisma.competitor.findMany({
        where: { workspaceId, brandId: task.brandId, enabled: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const snapshotConfig = (task.brandSnapshot ?? null) as
    | {
        brand?: {
          id: string;
          name: string;
          englishName?: string | null;
          websiteDomain: string | null;
          aliases: string[];
          officialSubdomains?: string[];
          products?: string[];
          productAliases?: string[];
        } | null;
        competitors?: Array<{ id: string; name: string; aliases: string[]; websiteDomain: string | null }>;
      }
    | null;

  const brand = task.brand
    ? {
        id: task.brand.id,
        name: task.brand.name,
        englishName: task.brand.englishName,
        websiteDomain: task.brand.websiteDomain,
        aliases: task.brand.aliases,
        officialSubdomains: task.brand.officialSubdomains ?? [],
        products: task.brand.products ?? [],
        productAliases: task.brand.productAliases ?? [],
      }
    : snapshotConfig?.brand
      ? {
          id: snapshotConfig.brand.id,
          name: snapshotConfig.brand.name,
          englishName: snapshotConfig.brand.englishName ?? null,
          websiteDomain: snapshotConfig.brand.websiteDomain,
          aliases: snapshotConfig.brand.aliases,
          officialSubdomains: snapshotConfig.brand.officialSubdomains ?? [],
          products: snapshotConfig.brand.products ?? [],
          productAliases: snapshotConfig.brand.productAliases ?? [],
        }
      : null;
  const competitorViews = snapshotConfig?.competitors ?? (task.brandId ? competitors.map((c) => ({
    id: c.id,
    name: c.name,
    aliases: c.aliases,
    websiteDomain: c.websiteDomain,
  })) : []);

  const entities: MatrixEntity[] = [
    ...(brand
      ? [{ key: `brand:${brand.id}`, kind: "BRAND" as const, id: brand.id, name: brand.name, websiteDomain: brand.websiteDomain }]
      : []),
    ...competitorViews.map((c) => ({
      key: `competitor:${c.id}`,
      kind: "COMPETITOR" as const,
      id: c.id,
      name: c.name,
      websiteDomain: c.websiteDomain,
    })),
  ];

  const evidenceRows = await prisma.evidence.findMany({
    where: { taskId, workspaceId },
    include: { result: { select: { itemId: true } } },
    orderBy: [{ collectedAt: "asc" }],
  });
  const resolved = evidenceRows.map((e) => resolveEvidence(e, brand));

  const byItem = new Map<string, ResolvedEvidence[]>();
  const byQuestion = new Map<string, ResolvedEvidence[]>();
  for (const ev of resolved) {
    if (ev.itemId) {
      const list = byItem.get(ev.itemId) ?? [];
      list.push(ev);
      byItem.set(ev.itemId, list);
    }
    if (ev.questionId) {
      const list = byQuestion.get(ev.questionId) ?? [];
      list.push(ev);
      byQuestion.set(ev.questionId, list);
    }
  }

  const questions: MatrixQuestion[] = task.items.map((item, index) => {
    const itemEvidence = byItem.get(item.id) ?? (item.questionId ? byQuestion.get(item.questionId) ?? [] : []);
    const { cells, questionState } = buildCells(item, itemEvidence, brand, competitorViews, entities);
    return {
      key: item.id || `item-${index}`,
      itemId: item.id,
      questionId: item.questionId,
      questionText: item.questionText,
      category: item.categorySnapshot?.trim() || item.question?.category?.trim() || "未分类",
      itemStatus: item.status,
      state: questionState,
      resultCount: item.resultCount,
      parseErrorCount: item.parseErrorCount,
      executedAt: iso(item.executedAt),
      cells,
    };
  });

  const validQuestions = questions.filter((q) => q.state !== "TASK_FAILED" && q.state !== "EMPTY" && q.state !== "NOT_COLLECTED");
  const brandEntity = entities.find((e) => e.kind === "BRAND");

  function cellFor(q: MatrixQuestion, entityKey: string): MatrixCell | undefined {
    return q.cells.find((c) => c.entityKey === entityKey);
  }

  const brandMentionedCount = brandEntity
    ? validQuestions.filter((q) => {
        const cell = cellFor(q, brandEntity.key);
        return cell?.found === true;
      }).length
    : 0;
  const officialCoveredCount = brandEntity
    ? validQuestions.filter((q) => cellFor(q, brandEntity.key)?.officialPageFound === true).length
    : 0;
  const thirdPartyCoveredCount = brandEntity
    ? validQuestions.filter((q) => cellFor(q, brandEntity.key)?.thirdPartyPageFound === true).length
    : 0;
  const needsReviewQuestions = brandEntity
    ? validQuestions.filter((q) => cellFor(q, brandEntity.key)?.state === "NEEDS_REVIEW").length
    : 0;
  const needsReviewEvidence = resolved.filter((ev) => isEvidenceNeedsReview(ev)).length;

  // 页面类型分布：品牌相关证据按规范化 URL 去重后统计
  const brandEvidence = resolved.filter((ev) => evidenceBelongsToBrand(ev));
  const uniqueBrandPages = new Map<string, ResolvedEvidence>();
  for (const ev of brandEvidence) {
    const key = pageKeyOf(ev.url);
    if (!uniqueBrandPages.has(key)) uniqueBrandPages.set(key, ev);
  }
  const typeCounts = new Map<PageTypeValue, number>();
  for (const ev of uniqueBrandPages.values()) {
    typeCounts.set(ev.pageType, (typeCounts.get(ev.pageType) ?? 0) + 1);
  }
  const totalUniquePages = uniqueBrandPages.size;
  const pageTypeDistribution: PageTypeDistributionRow[] = Array.from(typeCounts.entries())
    .map(([pageType, count]) => ({
      pageType,
      label: pageTypeLabel(pageType),
      count,
      share: totalUniquePages > 0 ? count / totalUniquePages : null,
    }))
    .sort((a, b) => b.count - a.count);

  const totalQuestions = task.items.length;
  const successItems = task.items.filter((i) => i.status === "SUCCESS").length;
  const failedItems = task.items.filter((i) => i.status === "FAILED").length;
  const cancelledItems = task.items.filter((i) => i.status === "CANCELLED").length;
  const notExecutedItems = task.items.filter((i) => i.status === "PENDING" || i.status === "RUNNING").length;
  const emptyItems = task.items.filter((i) => i.status === "SUCCESS" && i.resultCount === 0).length;
  const parseErrorItems = task.items.filter((i) => i.parseErrorCount > 0 || i.errorCategory === "PARTIAL_PARSE").length;

  const counts: RoundCounts = {
    totalQuestions,
    successItems,
    failedItems,
    emptyItems,
    cancelledItems,
    notExecutedItems,
    parseErrorItems,
    validQuestions: validQuestions.length,
    needsReviewEvidence,
    totalEvidence: resolved.length,
    uniquePages: totalUniquePages,
  };

  const validScope = `有效问题 ${validQuestions.length} 个（成功执行且至少 1 条结果）；失败 ${failedItems}、取消 ${cancelledItems}、空结果 ${emptyItems}、未执行 ${notExecutedItems} 不计入分母。`;
  const sampleStatusNote =
    validQuestions.length > 0 && validQuestions.length < MIN_RECOMMENDED_SAMPLE
      ? ` 样本量低于建议的 ${MIN_RECOMMENDED_SAMPLE} 个问题，结论仅作方向性参考。`
      : "";
  const hasOfficialConfig = Boolean(brand?.websiteDomain) || (brand?.officialSubdomains.length ?? 0) > 0;

  const metrics: RoundMetric[] = [
    makeMetric({
      key: "brand_mention_question_rate",
      label: "品牌提及问题率",
      numerator: brandMentionedCount,
      denominator: validQuestions.length,
      definition:
        "有效问题中，至少有一条证据被规则识别或人工确认为本品牌（官网域名、标题/摘要中的品牌名或别名、产品名，或人工确认）的问题占比。",
      sampleScope: validScope,
      notes:
        (brandEntity
          ? "同一问题多条结果只计一次；待复核证据不计入分子，单独展示。"
          : "任务未关联品牌或品牌已删除，无法计算。") + sampleStatusNote,
      breakdown: brandEntity
        ? {
            brand: brandEntity.name,
            mentionedQuestions: brandMentionedCount,
            needsReviewQuestions,
          }
        : undefined,
    }),
    makeMetric({
      key: "official_site_coverage",
      label: "官网结果覆盖率",
      numerator: officialCoveredCount,
      denominator: validQuestions.length,
      definition: "有效问题中，至少返回一个属于品牌官网（主域或已登记官方子域）页面的问题占比。",
      sampleScope: validScope,
      notes: brand?.websiteDomain || brand?.officialSubdomains.length
        ? "官网归属按规范化域名 + 已登记官方子域判定，不按字符串包含判断。"
        : "品牌尚未配置官网域名/官方子域，官网覆盖率不可计算。",
      ...(hasOfficialConfig ? {} : { value: null, notConfigured: true }),
      breakdown: { websiteDomain: brand?.websiteDomain ?? null, officialSubdomains: brand?.officialSubdomains ?? [] },
    }),
    makeMetric({
      key: "third_party_page_coverage",
      label: "第三方页面覆盖率",
      numerator: thirdPartyCoveredCount,
      denominator: validQuestions.length,
      definition: "有效问题中，至少有一个非官网（第三方）页面提及本品牌的问题占比。",
      sampleScope: validScope,
      notes: "仅统计非官网来源页面；官网页面单独计入官网覆盖率，避免重复归因。" + sampleStatusNote,
    }),
    makeMetric({
      key: "page_type_distribution",
      label: "页面类型分布",
      value: null,
      numerator: totalUniquePages,
      denominator: totalUniquePages,
      definition: "品牌相关证据中，按规范化 URL 去重后，各页面类型的数量与占比。",
      sampleScope: `品牌相关证据 ${brandEvidence.length} 条，去重后页面 ${totalUniquePages} 个。`,
      notes: "页面类型由可解释规则分类；OTHER/UNKNOWN 不做强行归类，可人工修正。",
      breakdown: pageTypeDistribution,
    }),
  ];

  // 问题类别覆盖
  const categoryAgg = new Map<string, { total: number; appeared: number }>();
  for (const q of validQuestions) {
    const entry = categoryAgg.get(q.category) ?? { total: 0, appeared: 0 };
    entry.total += 1;
    if (brandEntity && cellFor(q, brandEntity.key)?.found) entry.appeared += 1;
    categoryAgg.set(q.category, entry);
  }
  metrics.push(
    makeMetric({
      key: "category_coverage",
      label: "问题类别覆盖情况",
      numerator: Array.from(categoryAgg.values()).reduce((s, v) => s + v.appeared, 0),
      denominator: Array.from(categoryAgg.values()).reduce((s, v) => s + v.total, 0),
      definition: "按问题类别分组，统计每组中品牌被发现的问题数与有效率。分母与品牌提及问题率一致。",
      sampleScope: `${categoryAgg.size} 个问题类别；${validScope}`,
      notes: "类别来自任务创建时的问题类别快照，后续修改问题不会改变历史归类。",
      breakdown: Array.from(categoryAgg.entries())
        .map(([category, v]) => ({
          category,
          validQuestions: v.total,
          brandAppeared: v.appeared,
          rate: v.total > 0 ? v.appeared / v.total : null,
        }))
        .sort((a, b) => b.validQuestions - a.validQuestions),
    })
  );

  // 竞品提及问题率（与品牌同分母）
  for (const competitor of competitorViews) {
    const entity = entities.find((e) => e.kind === "COMPETITOR" && e.id === competitor.id);
    if (!entity) continue;
    const appeared = validQuestions.filter((q) => {
      const cell = cellFor(q, entity.key);
      return cell?.found === true;
    }).length;
    metrics.push(
      makeMetric({
        key: `competitor_mention_question_rate:${competitor.id}`,
        label: `竞品提及问题率 · ${competitor.name}`,
        numerator: appeared,
        denominator: validQuestions.length,
        definition: "与品牌提及问题率同一分母：有效问题中，至少一条证据提及该竞品（文本匹配或竞品官网域名）的问题占比。",
        sampleScope: validScope,
        notes: "竞品匹配使用竞品名称/别名 + 已配置官网域名；与品牌规则同源。",
      })
    );
  }

  const limitations: string[] = [];
  if (task.executionMode === "MOCK") limitations.push("本任务为模拟模式，结果不进入真实统计，不能作为品牌可见度结论。");
  if (failedItems > 0)
    limitations.push(`${failedItems} 个问题执行失败，未计入分母，也未当作「品牌未出现」。`);
  if (emptyItems > 0) limitations.push(`${emptyItems} 个问题返回空结果，单独展示为「结果为空」，未计入分母。`);
  if (parseErrorItems > 0)
    limitations.push(`${parseErrorItems} 个问题存在部分结果解析异常，仅保存解析成功的条目。`);
  if (validQuestions.length > 0 && validQuestions.length < MIN_RECOMMENDED_SAMPLE)
    limitations.push(`有效样本 ${validQuestions.length} 个，低于建议的 ${MIN_RECOMMENDED_SAMPLE} 个，指标波动可能较大。`);
  if (needsReviewEvidence > 0) limitations.push(`${needsReviewEvidence} 条证据待人工复核，当前未计入「已确认提及」。`);
  if (!hasOfficialConfig) limitations.push("品牌尚未配置官网域名/官方子域，官网结果覆盖率不可计算。");
  limitations.push("指标仅反映本次搜索任务返回的网页结果，不代表所有 AI 平台的综合可见性，也不等同于最终生成式回答的引用。");

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
      startedAt: iso(task.startedAt),
      finishedAt: iso(task.finishedAt),
      createdAt: task.createdAt.toISOString(),
      params: (task.params ?? {}) as Record<string, unknown>,
      brandSnapshot: (task.brandSnapshot ?? null) as Record<string, unknown> | null,
      isMock: task.executionMode === "MOCK",
    },
    brand,
    competitors: competitorViews,
    entities,
    questions,
    evidence: resolved,
    metrics,
    pageTypeDistribution,
    counts,
    ruleVersion: EVIDENCE_RULE_VERSION,
    limitations,
  };
}

/** 找出某品牌最近一次成功/部分成功、包含有效样本的真实采集任务。 */
export async function findLatestRoundTaskId(
  workspaceId: string,
  brandId: string,
  options: { includeMock?: boolean } = {}
): Promise<string | null> {
  const task = await prisma.searchTask.findFirst({
    where: {
      workspaceId,
      brandId,
      status: { in: ["COMPLETED", "PARTIAL_FAILED"] },
      ...(options.includeMock ? {} : { executionMode: "REAL" }),
      items: { some: { status: "SUCCESS", resultCount: { gt: 0 } } },
    },
    orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  return task?.id ?? null;
}

/** 当前工作空间中可查看矩阵的轮次列表（默认真实数据）。 */
export async function listRoundTasks(
  workspaceId: string,
  options: { brandId?: string; includeMock?: boolean; limit?: number } = {}
) {
  const tasks = await prisma.searchTask.findMany({
    where: {
      workspaceId,
      ...(options.brandId ? { brandId: options.brandId } : {}),
      ...(options.includeMock ? {} : { executionMode: "REAL" }),
      status: { in: ["COMPLETED", "PARTIAL_FAILED", "FAILED", "CANCELLED"] },
    },
    orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
    take: options.limit ?? 50,
    include: { brand: { select: { name: true } } },
  });
  return tasks.map((t) => ({
    id: t.id,
    name: t.name,
    brandId: t.brandId,
    brandName: t.brand?.name ?? null,
    status: t.status,
    executionMode: t.executionMode,
    source: t.source,
    questionSetVersion: t.questionSetVersion,
    baselineTaskId: t.baselineTaskId,
    totalItems: t.totalItems,
    successItems: t.successItems,
    failedItems: t.failedItems,
    emptyItems: t.emptyItems,
    finishedAt: iso(t.finishedAt),
    createdAt: t.createdAt.toISOString(),
  }));
}
