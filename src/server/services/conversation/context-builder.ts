import type { SearchResult } from "@prisma/client";

// —— 搜索上下文构建：纯函数，供编排器与单元测试使用 ——

export interface ContextSource {
  /** 1 起始的来源编号，与提示词中的 [n] 对应 */
  index: number;
  searchResultId: string;
  title: string;
  url: string;
  domain: string | null;
  snippet: string;
  publishedAt: string | null;
}

export interface BuiltSearchContext {
  sources: ContextSource[];
  /** 提供给模型的知识块（含编号） */
  contextText: string;
}

/** URL 规范化去重：小写 host、去尾部斜杠、去除常见追踪参数；保留原始 URL。 */
export function normalizeUrlForDedup(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return url;
    const tracked = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "spm", "from", "ref", "ref_src", "igshid", "fbclid", "gclid"];
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (tracked.includes(key.toLowerCase())) parsed.searchParams.delete(key);
    }
    parsed.hash = "";
    let normalized = `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}`;
    const query = parsed.searchParams.toString();
    if (query) normalized += `?${query}`;
    return normalized;
  } catch {
    return url;
  }
}

/** 去除重复与无效结果（非法 URL / 空 URL），保持原始顺序。 */
export function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const output: SearchResult[] = [];
  for (const result of results) {
    if (!result.url || !/^https?:\/\//i.test(result.url)) continue;
    const key = normalizeUrlForDedup(result.url);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(result);
  }
  return output;
}

export interface BuildContextOptions {
  /** 传给模型的来源上限 */
  maxSources?: number;
  /** 单条摘要长度上限 */
  maxSnippetLength?: number;
}

/**
 * 构建带编号的来源上下文：
 * 1. 去重/过滤
 * 2. 截断摘要
 * 3. 分配执行内唯一编号（1 起始）
 */
export function buildSearchContext(rawResults: SearchResult[], options: BuildContextOptions = {}): BuiltSearchContext {
  const maxSources = options.maxSources ?? 8;
  const maxSnippetLength = options.maxSnippetLength ?? 500;
  const deduped = dedupeResults(rawResults).slice(0, maxSources);
  const sources: ContextSource[] = deduped.map((result, i) => ({
    index: i + 1,
    searchResultId: result.id,
    title: result.title || "(无标题)",
    url: result.url,
    domain: result.domain,
    snippet: (result.snippet ?? "").slice(0, maxSnippetLength) || "(接口未返回摘要)",
    publishedAt: result.publishedAt ?? null,
  }));
  if (sources.length === 0) {
    return { sources, contextText: "（本次搜索没有返回可用来源）" };
  }
  const lines = sources.map((s) => {
    const date = s.publishedAt ? `（发布时间：${s.publishedAt}）` : "";
    return `[${s.index}] 标题：${s.title}${date}\n    来源：${s.url}\n    摘要：${s.snippet}`;
  });
  return { sources, contextText: lines.join("\n\n") };
}

const CITATION_RE = /\[(\d{1,2})\]/g;

export interface CitationValidation {
  /** 移除无效引用后的安全文本 */
  cleanedText: string;
  /** 被移除的无效编号（去重） */
  removed: number[];
  /** 文本中实际使用的有效编号（去重、升序） */
  used: number[];
}

/**
 * 校验模型输出中的引用编号：
 * 只有存在于当前执行来源集合（1..maxIndex）的编号才保留；
 * 不存在的编号被移除，防止模型伪造来源。
 */
export function validateCitations(text: string, maxIndex: number): CitationValidation {
  if (maxIndex <= 0) {
    return { cleanedText: text.replace(CITATION_RE, ""), removed: [], used: [] };
  }
  const removed = new Set<number>();
  const used = new Set<number>();
  const cleaned = text.replace(CITATION_RE, (match, numText: string) => {
    const num = Number(numText);
    if (Number.isInteger(num) && num >= 1 && num <= maxIndex) {
      used.add(num);
      return match;
    }
    removed.add(num);
    return "";
  });
  return {
    cleanedText: cleaned,
    removed: Array.from(removed).sort((a, b) => a - b),
    used: Array.from(used).sort((a, b) => a - b),
  };
}

/** 多轮上下文：限制条数与总长度，按用户/会话隔离由调用方保证。 */
export function trimHistory(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  maxMessages = 10,
  maxTotalChars = 8000
): Array<{ role: "user" | "assistant"; content: string }> {
  const picked = history.slice(-maxMessages).map((m) => ({
    role: m.role,
    content: m.content.slice(0, 2000),
  }));
  let total = 0;
  const output: typeof picked = [];
  for (let i = picked.length - 1; i >= 0; i -= 1) {
    const message = picked[i];
    if (!message) continue;
    total += message.content.length;
    if (total > maxTotalChars && output.length > 0) break;
    output.unshift(message);
  }
  return output;
}
