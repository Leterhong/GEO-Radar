import { sameSite } from "@/server/services/domain-normalization";

// —— GEO 分析指标引擎（确定性计算，模型不得参与数值产生）——
// 统计对象：会话「搜索并回答」模式中，带真实搜索来源且回答成功的执行记录（answer 级）。
// 分母 = 有效回答数（有 ≥1 条真实来源的回答）。无来源回答单独计数，不进入分母。

export interface CorpusSource {
  url: string;
  domain: string | null;
  /** 该来源证据的品牌提及判定（RULE/MANUAL 后的最终状态） */
  mentionStatus: string;
}

export interface CorpusItem {
  runId: string;
  question: string;
  answer: string;
  /** 回答完成时间（ISO） */
  answeredAt: string;
  sources: CorpusSource[];
}

export interface BrandTerms {
  name: string;
  aliases: string[];
  websiteDomain: string | null;
}

export interface CompetitorTerms {
  id: string;
  name: string;
  aliases: string[];
}

export interface ComputedMetric {
  key: string;
  label: string;
  value: number | null;
  numerator: number;
  denominator: number;
  insufficient: boolean;
  notes?: string;
  breakdown?: unknown;
}

export const FORMULA_VERSION = "v1";

/** 统一小写、全角转半角、压缩空白，用于确定性匹配 */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isLatinTerm(term: string): boolean {
  return /^[\x20-\x7E]+$/.test(term);
}

/** 统计术语出现次数：拉丁词按词边界，CJK 按包含计数 */
export function countTermOccurrences(text: string, term: string): number {
  const normalizedText = normalizeForMatch(text);
  const normalizedTerm = normalizeForMatch(term).trim();
  if (normalizedTerm === "" || normalizedText === "") return 0;
  if (isLatinTerm(normalizedTerm)) {
    const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu");
    return (normalizedText.match(re) ?? []).length;
  }
  let count = 0;
  let index = normalizedText.indexOf(normalizedTerm);
  while (index !== -1) {
    count += 1;
    index = normalizedText.indexOf(normalizedTerm, index + normalizedTerm.length);
  }
  return count;
}

export function entityTerms(entity: { name: string; aliases: string[] }): string[] {
  return Array.from(new Set([entity.name, ...entity.aliases].map((t) => t.trim()).filter((t) => t !== "")));
}

/** 是否提及（任一名称/别名命中） */
export function mentionsEntity(text: string, entity: { name: string; aliases: string[] }): boolean {
  return entityTerms(entity).some((term) => countTermOccurrences(text, term) > 0);
}

/**
 * 来源是否可归因到品牌：
 * 1) 来源域名与品牌官网同站（可验证的官网归属）；
 * 2) 该来源证据已被确认为本品牌（CONFIRMED_BRAND，规则或人工）。
 * 仅品牌名出现在回答正文里不算「引用」。
 */
export function isBrandAttributableSource(source: CorpusSource, brand: BrandTerms): boolean {
  if (source.mentionStatus === "CONFIRMED_BRAND") return true;
  if (brand.websiteDomain && source.domain && sameSite(source.domain, brand.websiteDomain)) return true;
  return false;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export interface ComputeMetricsInput {
  corpus: CorpusItem[];
  brand: BrandTerms;
  competitors: CompetitorTerms[];
  /** 用于关键词表现的品牌关键词（可选） */
  keywords?: string[];
  /** 统计窗口内（ISO）——调用方已按时间过滤 corpus，这里用于文档说明 */
  windowFrom?: string;
  windowTo?: string;
}

export interface ComputeMetricsOutput {
  metrics: ComputedMetric[];
  answerCount: number;
  answersWithoutSources: number;
  sampleSize: number;
}

/**
 * 计算 answer 级指标：
 * - 有效回答数（分母）
 * - 品牌提及率 / 品牌提及次数
 * - 品牌引用率（可归因来源）
 * - 官网引用率（官网同站来源）
 * - 竞品提及率
 * - 关键词表现
 * - 按日趋势
 */
export function computeAnswerMetrics(input: ComputeMetricsInput): ComputeMetricsOutput {
  const { corpus, brand, competitors, keywords = [] } = input;
  const valid = corpus.filter((item) => item.sources.length > 0);
  const answersWithoutSources = corpus.length - valid.length;
  const denominator = valid.length;

  const brandMentioned = valid.filter((item) => mentionsEntity(item.answer, brand)).length;
  const brandMentionCount = valid.reduce((sum, item) => sum + entityTerms(brand).reduce((s, t) => s + countTermOccurrences(item.answer, t), 0), 0);
  const brandCited = valid.filter((item) =>
    item.sources.some((source) => isBrandAttributableSource(source, brand))
  ).length;
  const officialCited = brand.websiteDomain
    ? valid.filter((item) => item.sources.some((s) => s.domain !== null && sameSite(s.domain, brand.websiteDomain as string))).length
    : 0;

  const metrics: ComputedMetric[] = [
    {
      key: "valid_answers",
      label: "有效回答数",
      value: denominator,
      numerator: denominator,
      denominator: corpus.length,
      insufficient: false,
      notes: `统计范围内共 ${corpus.length} 条搜索问答执行，其中 ${answersWithoutSources} 条没有返回可核查来源，未计入分母。`,
    },
    {
      key: "brand_mention_rate",
      label: "品牌提及率",
      value: rate(brandMentioned, denominator),
      numerator: brandMentioned,
      denominator,
      insufficient: denominator === 0,
      notes:
        denominator === 0
          ? "暂无有效回答样本，无法计算品牌提及率。"
          : "口径：回答正文中出现品牌名称或已登记别名的回答数 ÷ 有效回答数。仅代表本次样本的文本提及，不代表 AI 推荐或用户认知变化。",
    },
    {
      key: "brand_mention_count",
      label: "品牌提及次数",
      value: brandMentionCount,
      numerator: brandMentionCount,
      denominator,
      insufficient: denominator === 0,
      notes: "口径：所有有效回答中品牌名称与别名的累计出现次数（同一回答多次出现会重复计数）。",
    },
    {
      key: "brand_citation_rate",
      label: "品牌引用率",
      value: rate(brandCited, denominator),
      numerator: brandCited,
      denominator,
      insufficient: denominator === 0,
      notes:
        denominator === 0
          ? "暂无有效回答样本，无法计算品牌引用率。"
          : brand.websiteDomain
            ? "口径：回答引用了可归因到本品牌的来源（官网同站域名，或已被确认为本品牌的证据）的回答数 ÷ 有效回答数。品牌名出现在正文中不等于引用。"
            : "口径：回答引用了已被确认为本品牌的来源的回答数 ÷ 有效回答数。建议在品牌档案中补充官网域名以提高归属判定准确度。",
    },
    {
      key: "official_citation_rate",
      label: "官网引用率",
      value: brand.websiteDomain ? rate(officialCited, denominator) : null,
      numerator: officialCited,
      denominator,
      insufficient: !brand.websiteDomain || denominator === 0,
      notes: brand.websiteDomain
        ? "口径：回答引用了品牌官网同站来源的回答数 ÷ 有效回答数。"
        : "品牌未配置官网域名，无法计算官网引用率。",
    },
  ];

  for (const competitor of competitors) {
    const mentioned = valid.filter((item) => mentionsEntity(item.answer, competitor)).length;
    metrics.push({
      key: `competitor_mention_rate:${competitor.id}`,
      label: `竞品提及率 · ${competitor.name}`,
      value: rate(mentioned, denominator),
      numerator: mentioned,
      denominator,
      insufficient: denominator === 0,
      notes: "口径与品牌提及率一致，使用同一批有效回答作为分母。",
    });
  }

  if (keywords.length > 0) {
    const breakdown = keywords.map((keyword) => {
      const matched = valid.filter((item) => countTermOccurrences(item.question, keyword) > 0);
      const mentioned = matched.filter((item) => mentionsEntity(item.answer, brand)).length;
      return {
        keyword,
        answers: matched.length,
        brandMentioned: mentioned,
        rate: rate(mentioned, matched.length),
      };
    });
    metrics.push({
      key: "keyword_breakdown",
      label: "关键词表现",
      value: null,
      numerator: breakdown.reduce((s, b) => s + b.brandMentioned, 0),
      denominator: breakdown.reduce((s, b) => s + b.answers, 0),
      insufficient: breakdown.every((b) => b.answers === 0),
      notes: "口径：按问题中是否包含品牌配置的关键词分组，统计该组回答的品牌提及率。",
      breakdown,
    });
  }

  // 按日趋势
  const byDay = new Map<string, { total: number; mentioned: number }>();
  for (const item of valid) {
    const day = item.answeredAt.slice(0, 10);
    const entry = byDay.get(day) ?? { total: 0, mentioned: 0 };
    entry.total += 1;
    if (mentionsEntity(item.answer, brand)) entry.mentioned += 1;
    byDay.set(day, entry);
  }
  metrics.push({
    key: "daily_trend",
    label: "品牌提及趋势",
    value: null,
    numerator: Array.from(byDay.values()).reduce((s, d) => s + d.mentioned, 0),
    denominator: denominator,
    insufficient: byDay.size === 0,
    notes: "口径：按回答完成日期分组统计品牌提及率；不生成无数据日期。",
    breakdown: Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, entry]) => ({
        date,
        answers: entry.total,
        brandMentioned: entry.mentioned,
        rate: entry.total > 0 ? entry.mentioned / entry.total : null,
      })),
  });

  return {
    metrics,
    answerCount: denominator,
    answersWithoutSources,
    sampleSize: corpus.length,
  };
}

export interface LabQuestionSetRow {
  questionSet: string;
  validQuestions: number;
  brandAppeared: number;
}

/** 实验室（问题集）维度的补充指标：按问题集统计品牌出现率 */
export function computeLabQuestionSetBreakdown(rows: LabQuestionSetRow[]): ComputedMetric {
  const total = rows.reduce((s, r) => s + r.validQuestions, 0);
  const appeared = rows.reduce((s, r) => s + r.brandAppeared, 0);
  return {
    key: "lab_question_set_breakdown",
    label: "问题集表现（实验室任务）",
    value: total > 0 ? appeared / total : null,
    numerator: appeared,
    denominator: total,
    insufficient: total === 0,
    notes:
      total === 0
        ? "统计范围内没有实验室任务的真实成功样本，无法计算问题集维度指标。"
        : "口径：实验室真实任务中，按问题集统计「存在至少一条已确认品牌提及证据」的问题数 ÷ 有效完成问题数。",
    breakdown: rows.map((r) => ({
      questionSet: r.questionSet,
      validQuestions: r.validQuestions,
      brandAppeared: r.brandAppeared,
      rate: r.validQuestions > 0 ? r.brandAppeared / r.validQuestions : null,
    })),
  };
}
