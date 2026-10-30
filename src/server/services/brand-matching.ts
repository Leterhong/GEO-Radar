import type { MentionStatus, PageType, SourceRole } from "@prisma/client";
import { classifyPage } from "@/lib/page-classification";
import { normalizeUrl } from "@/lib/url-normalization";
import { termMatch } from "./mention-detection";

/**
 * 页面级证据分析（规则版本见 EVIDENCE_RULE_VERSION）。
 * 结果全部可解释：每个匹配依据、页面分类规则、来源角色都会落库。
 * 不推断「是否被最终生成式回答引用」——该信息无法从普通搜索结果得到。
 */

export const EVIDENCE_RULE_VERSION = "evidence-v3";

export interface BrandMatchConfig {
  name: string;
  englishName?: string | null;
  aliases: string[];
  websiteDomain?: string | null;
  officialSubdomains?: string[] | null;
  products?: string[] | null;
  productAliases?: string[] | null;
}

export interface CompetitorMatchConfig {
  name: string;
  aliases: string[];
  websiteDomain?: string | null;
}

export interface EvidencePageInput {
  url: string;
  title?: string | null;
  snippet?: string | null;
  fullContent?: string | null;
  domain?: string | null;
  siteName?: string | null;
  publishedAt?: string | null;
}

export interface EvidenceAnalysis {
  normalizedUrl: string | null;
  urlValid: boolean;
  pageType: PageType;
  sourceRole: SourceRole;
  pageTypeRule: string;
  pageTypeReason: string;
  pageTypeConfidence: "high" | "low";
  officialDomainMatch: boolean;
  thirdPartyMention: boolean;
  mentionStatus: MentionStatus;
  detectionMethod: "RULE";
  brandMatchBasis: string[];
  matchedTerms: string[];
  competitorMatches: string[];
  confidence: "high" | "low";
  relevance: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  ruleVersion: string;
}

type TermKind = "NAME" | "ALIAS" | "PRODUCT_NAME" | "PRODUCT_ALIAS";

interface FieldMatch {
  basis: string;
  term: string;
  lowConfidence: boolean;
}

function matchTermsInField(
  text: string | null | undefined,
  terms: Array<{ term: string; kind: TermKind }>,
  field: "TITLE" | "SNIPPET"
): FieldMatch[] {
  const haystack = (text ?? "").toLowerCase();
  if (haystack === "") return [];
  const matches: FieldMatch[] = [];
  for (const { term, kind } of terms) {
    const result = termMatch(haystack, term);
    if (!result.matched) continue;
    matches.push({
      basis: `${field}_${kind}`,
      term,
      // 只对「别名/产品别名」的短拉丁词降级；正式名称/产品名称本身具备明确指代性
      lowConfidence: result.lowConfidence && (kind === "ALIAS" || kind === "PRODUCT_ALIAS"),
    });
  }
  return matches;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function analyzeEvidencePage(
  input: EvidencePageInput,
  brand: BrandMatchConfig | null,
  competitors: CompetitorMatchConfig[]
): EvidenceAnalysis {
  const normalized = normalizeUrl(input.url);
  const classification = classifyPage({
    url: input.url,
    domain: input.domain,
    title: input.title,
    snippet: input.snippet,
    siteName: input.siteName,
    brand: brand
      ? { websiteDomain: brand.websiteDomain ?? null, officialSubdomains: brand.officialSubdomains ?? [] }
      : null,
  });

  const brandTerms: Array<{ term: string; kind: TermKind }> = [];
  if (brand) {
    if (brand.name.trim() !== "") brandTerms.push({ term: brand.name.trim(), kind: "NAME" });
    if (brand.englishName?.trim() && brand.englishName.trim() !== brand.name.trim()) {
      brandTerms.push({ term: brand.englishName.trim(), kind: "NAME" });
    }
    for (const alias of brand.aliases ?? []) {
      if (alias.trim() !== "") brandTerms.push({ term: alias.trim(), kind: "ALIAS" });
    }
    for (const product of brand.products ?? []) {
      if (product.trim() !== "") brandTerms.push({ term: product.trim(), kind: "PRODUCT_NAME" });
    }
    for (const product of brand.productAliases ?? []) {
      if (product.trim() !== "") brandTerms.push({ term: product.trim(), kind: "PRODUCT_ALIAS" });
    }
  }

  // 摘要：优先使用接口返回的 passage；没有 passage 时才回退到 content（并在依据中保持 SNIPPET_* 前缀）
  const snippetText = input.snippet && input.snippet.trim() !== "" ? input.snippet : input.fullContent;
  const titleMatches = matchTermsInField(input.title, brandTerms, "TITLE");
  const snippetMatches = matchTermsInField(snippetText, brandTerms, "SNIPPET");
  const textMatches = [...titleMatches, ...snippetMatches];

  const competitorMatches: string[] = [];
  for (const competitor of competitors) {
    const competitorTerms = [
      ...(competitor.name.trim() !== "" ? [competitor.name.trim()] : []),
      ...(competitor.aliases ?? []).filter((a) => a.trim() !== ""),
    ];
    const hit = competitorTerms.some((term) => termMatch((input.title ?? "").toLowerCase(), term).matched)
      || competitorTerms.some((term) => termMatch((snippetText ?? "").toLowerCase(), term).matched);
    if (hit) competitorMatches.push(competitor.name);
  }

  const lowConfidenceMatch = textMatches.some((m) => m.lowConfidence);
  const highConfidenceTextMatch = textMatches.some((m) => !m.lowConfidence);
  const textEmpty = (input.title ?? "").trim() === "" && (snippetText ?? "").trim() === "";
  const anyBrandMatch = classification.isOfficialDomain || textMatches.length > 0;

  let mentionStatus: MentionStatus;
  if (classification.isOfficialDomain) {
    mentionStatus = "CONFIRMED_BRAND";
  } else if (highConfidenceTextMatch) {
    mentionStatus = "CONFIRMED_BRAND";
  } else if (lowConfidenceMatch) {
    mentionStatus = "PENDING_REVIEW";
  } else if (textEmpty) {
    mentionStatus = "PENDING_REVIEW";
  } else if (competitorMatches.length > 0) {
    mentionStatus = "CONFIRMED_COMPETITOR";
  } else {
    mentionStatus = "IRRELEVANT";
  }

  const brandMatchBasis: string[] = [];
  if (classification.isOfficialDomain) brandMatchBasis.push("OFFICIAL_DOMAIN");
  for (const match of textMatches) brandMatchBasis.push(match.basis);
  if (lowConfidenceMatch) brandMatchBasis.push("LOW_CONFIDENCE_ALIAS");
  if (brandMatchBasis.length === 0) {
    brandMatchBasis.push(competitorMatches.length > 0 ? "COMPETITOR_ONLY" : "NONE");
  }

  const confidence: "high" | "low" =
    classification.isOfficialDomain || highConfidenceTextMatch ? "high" : "low";

  const titleHit = titleMatches.length > 0;
  const relevance: EvidenceAnalysis["relevance"] =
    classification.isOfficialDomain || titleHit
      ? "HIGH"
      : snippetMatches.length > 0
        ? "MEDIUM"
        : competitorMatches.length > 0
          ? "LOW"
          : "UNKNOWN";

  return {
    normalizedUrl: normalized.normalized,
    urlValid: normalized.valid,
    pageType: classification.pageType as PageType,
    sourceRole: classification.sourceRole as SourceRole,
    pageTypeRule: classification.ruleId,
    pageTypeReason: classification.reason,
    pageTypeConfidence: classification.confidence,
    officialDomainMatch: classification.isOfficialDomain,
    thirdPartyMention: anyBrandMatch && classification.sourceRole !== "OFFICIAL",
    mentionStatus,
    detectionMethod: "RULE",
    brandMatchBasis: dedupe(brandMatchBasis),
    matchedTerms: dedupe(textMatches.map((m) => m.term)),
    competitorMatches: dedupe(competitorMatches),
    confidence,
    relevance,
    ruleVersion: EVIDENCE_RULE_VERSION,
  };
}

/** 匹配依据 → 中文说明（证据详情/报告展示，不参与计算） */
export function describeBasis(basis: string): string {
  const map: Record<string, string> = {
    OFFICIAL_DOMAIN: "官网域名匹配",
    TITLE_NAME: "标题包含品牌正式名称",
    TITLE_ALIAS: "标题包含品牌别名",
    TITLE_PRODUCT_NAME: "标题包含产品名称",
    TITLE_PRODUCT_ALIAS: "标题包含产品别名",
    SNIPPET_NAME: "摘要包含品牌正式名称",
    SNIPPET_ALIAS: "摘要包含品牌别名",
    SNIPPET_PRODUCT_NAME: "摘要包含产品名称",
    SNIPPET_PRODUCT_ALIAS: "摘要包含产品别名",
    LOW_CONFIDENCE_ALIAS: "短别名匹配（需人工复核）",
    COMPETITOR_ONLY: "仅匹配到竞品",
    LEGACY_MATCH: "旧规则匹配（未记录匹配依据，建议用当前规则重算）",
    NONE: "未匹配到品牌或竞品",
  };
  return map[basis] ?? basis;
}
