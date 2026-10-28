import type { Brand, Competitor } from "@prisma/client";
import { sameSite } from "./domain-normalization";

export interface MentionMatch {
  matched: boolean;
  matchedTerms: string[];
  confidence: "high" | "low";
}

/**
 * 品牌提及规则识别（可解释、可追溯）：
 * 1. 官网域名匹配（同站判定，强信号 → high confidence）
 * 2. 品牌名/别名文本匹配：
 *    - 拉丁字符使用词边界，避免子串误报
 *    - CJK（≥2 字符）使用包含匹配
 *    - 过短别名（拉丁 ≤3 字符）标记 low confidence，进入人工复核
 * 匹配结果只是规则判断，不等于品牌一定被 AI 答案推荐。
 */
export function matchEntityInText(
  entity: { name: string; aliases: string[]; websiteDomain?: string | null },
  text: { title?: string | null; snippet?: string | null; url?: string | null; domain?: string | null }
): MentionMatch {
  const matchedTerms: string[] = [];
  const haystackParts = [text.title, text.snippet].filter((t): t is string => Boolean(t && t !== ""));
  const haystack = haystackParts.join(" ").toLowerCase();

  // 官网域名匹配
  if (entity.websiteDomain && text.domain && sameSite(text.domain, entity.websiteDomain)) {
    matchedTerms.push(`domain:${entity.websiteDomain}`);
    return { matched: true, matchedTerms, confidence: "high" };
  }
  // URL 中的域名兜底
  if (entity.websiteDomain && text.url) {
    try {
      const host = new URL(text.url).hostname;
      if (sameSite(host, entity.websiteDomain)) {
        matchedTerms.push(`domain:${entity.websiteDomain}`);
        return { matched: true, matchedTerms, confidence: "high" };
      }
    } catch {
      // 非法 URL 忽略
    }
  }

  const terms = [entity.name, ...entity.aliases].map((t) => t.trim()).filter((t) => t !== "");
  let lowConfidence = false;
  for (const term of terms) {
    const result = termMatch(haystack, term);
    if (!result.matched) continue;
    matchedTerms.push(term);
    if (result.lowConfidence) lowConfidence = true;
  }
  return {
    matched: matchedTerms.some((t) => !t.startsWith("domain:")),
    matchedTerms,
    confidence: lowConfidence ? "low" : "high",
  };
}

/**
 * 单个术语的匹配（供提及识别与证据匹配共享，避免两套不一致规则）。
 * - 拉丁术语：词边界匹配；≤3 字符标记 lowConfidence（易误报，进入人工复核）
 * - CJK/其他：≥2 字符包含匹配
 */
export function termMatch(haystack: string, term: string): { matched: boolean; lowConfidence: boolean } {
  const lower = term.trim().toLowerCase();
  if (lower === "" || haystack === "") return { matched: false, lowConfidence: false };
  if (isLatin(lower)) {
    const matched = wordBoundaryMatch(haystack, lower);
    return { matched, lowConfidence: matched && lower.length <= 3 };
  }
  return { matched: lower.length >= 2 && haystack.includes(lower), lowConfidence: false };
}

function isLatin(term: string): boolean {
  return /^[\x20-\x7E]+$/.test(term);
}

function wordBoundaryMatch(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u");
  return re.test(haystack);
}

export interface EvidenceMentionOutcome {
  mentionStatus: "PENDING_REVIEW" | "CONFIRMED_BRAND" | "CONFIRMED_COMPETITOR" | "IRRELEVANT" | "AMBIGUOUS";
  detectionMethod: "RULE" | "MANUAL";
  matchedTerms: string[];
  competitorMatches: string[];
  confidence: "high" | "low";
}

/**
 * 对单条搜索结果执行品牌 + 竞品规则识别。
 * - 品牌命中 → CONFIRMED_BRAND；仅竞品命中 → CONFIRMED_COMPETITOR
 * - 文本为空或低置信匹配 → PENDING_REVIEW
 * - 无命中 → IRRELEVANT（仅表示"未检测到提及"，不代表绝对不存在）
 */
export function detectMention(
  brand: Pick<Brand, "name" | "aliases" | "websiteDomain"> | null,
  competitors: Array<Pick<Competitor, "name" | "aliases" | "websiteDomain">>,
  text: { title?: string | null; snippet?: string | null; url?: string | null; domain?: string | null }
): EvidenceMentionOutcome {
  const brandMatch = brand ? matchEntityInText(brand, text) : { matched: false, matchedTerms: [], confidence: "high" as const };
  const competitorMatches: string[] = [];
  let competitorHit = false;
  for (const competitor of competitors) {
    const m = matchEntityInText(competitor, text);
    if (m.matched) {
      competitorHit = true;
      competitorMatches.push(competitor.name);
    }
  }
  const textEmpty = !((text.title ?? "") !== "" || (text.snippet ?? "") !== "");
  if (brandMatch.matched) {
    return {
      mentionStatus: brandMatch.confidence === "low" ? "PENDING_REVIEW" : "CONFIRMED_BRAND",
      detectionMethod: "RULE",
      matchedTerms: brandMatch.matchedTerms,
      competitorMatches,
      confidence: brandMatch.confidence,
    };
  }
  if (textEmpty || brandMatch.confidence === "low") {
    return {
      mentionStatus: "PENDING_REVIEW",
      detectionMethod: "RULE",
      matchedTerms: [],
      competitorMatches,
      confidence: "low",
    };
  }
  if (competitorHit) {
    return {
      mentionStatus: "CONFIRMED_COMPETITOR",
      detectionMethod: "RULE",
      matchedTerms: [],
      competitorMatches,
      confidence: "high",
    };
  }
  return {
    mentionStatus: "IRRELEVANT",
    detectionMethod: "RULE",
    matchedTerms: [],
    competitorMatches,
    confidence: "high",
  };
}
