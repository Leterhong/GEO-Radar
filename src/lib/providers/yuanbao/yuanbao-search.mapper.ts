import type { SearchRequest, SearchResponse, SearchResult } from "@/lib/providers/types";
import type { YuanbaoPage } from "./yuanbao-search.schema";

/** 从 URL 提取域名；解析失败返回 undefined，不猜测。 */
export function extractDomain(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * 将元宝单条结果映射为统一结果对象。
 * 供应商未返回的字段保持 undefined；score/authority_level 仅在真实返回且类型合法时保存。
 */
export function mapYuanbaoPage(page: YuanbaoPage, position: number, rawEvidenceRef?: string): SearchResult {
  const url = page.url ?? "";
  return {
    position,
    title: page.title ?? "",
    url,
    domain: url ? extractDomain(url) : undefined,
    snippet: page.passage,
    fullContent: page.content,
    siteName: page.site && page.site !== "" ? page.site : undefined,
    publishedAt: page.date,
    score: page.score,
    authorityLevel: page.authority_level,
    pics: page.pics?.map((p) => ({ caption: p.caption, originUrl: p.origin_url })),
    favicon: page.favicon && page.favicon !== "" ? page.favicon : undefined,
    deeplinks: page.deeplinks?.map((d) => ({ title: d.title, url: d.url })),
    rawEvidenceRef,
  };
}

export interface RawProviderEnvelope {
  Query?: unknown;
  Pages?: unknown;
  RequestId?: unknown;
  Version?: unknown;
  Msg?: unknown;
  Error?: { Code?: unknown; Message?: unknown };
}

/**
 * 解析供应商响应外层结构。
 * 兼容 { Response: {...} } 官方包裹格式；缺失必要字段时抛出可分类错误。
 */
export function extractProviderEnvelope(payload: unknown): {
  query?: string;
  pages: unknown[];
  requestId?: string;
  version?: string;
  msg?: string;
} {
  if (payload === null || typeof payload !== "object") {
    throw new TypeError("响应体不是 JSON 对象");
  }
  const root = payload as Record<string, unknown>;
  const inner = (root.Response ?? root) as Record<string, unknown>;
  if (inner === null || typeof inner !== "object" || Array.isArray(inner)) {
    throw new TypeError("响应缺少 Response 对象");
  }
  const envelope = inner as RawProviderEnvelope;
  if (envelope.Error && typeof envelope.Error === "object") {
    const err = envelope.Error as { Code?: unknown; Message?: unknown };
    const error = new Error("PROVIDER_BUSINESS_ERROR") as Error & {
      code?: string;
      providerMessage?: string;
    };
    error.code = typeof err.Code === "string" ? err.Code : undefined;
    error.providerMessage = typeof err.Message === "string" ? err.Message : undefined;
    throw error;
  }
  const rawPages = envelope.Pages;
  if (rawPages === undefined) {
    const missing = new Error("响应缺少必要字段 Pages") as Error & { missingField?: string };
    missing.missingField = "Pages";
    throw missing;
  }
  if (!Array.isArray(rawPages)) {
    const bad = new Error("Pages 不是数组") as Error & { missingField?: string };
    bad.missingField = "Pages";
    throw bad;
  }
  return {
    query: typeof envelope.Query === "string" ? envelope.Query : undefined,
    pages: rawPages,
    requestId: typeof envelope.RequestId === "string" ? envelope.RequestId : undefined,
    version: typeof envelope.Version === "string" ? envelope.Version : undefined,
    msg: typeof envelope.Msg === "string" ? envelope.Msg : undefined,
  };
}

/**
 * 提取业务错误：官方 SearchPro 在业务失败时返回 HTTP 200，
 * 错误位于 { Response: { Error: { Code, Message }, RequestId } }。
 */
export function extractBusinessError(
  payload: unknown
): { code: string; message: string; requestId?: string } | null {
  if (payload === null || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const inner = (root.Response ?? root) as Record<string, unknown> | null;
  if (!inner || typeof inner !== "object") return null;
  const error = (inner as { Error?: unknown }).Error;
  if (!error || typeof error !== "object") return null;
  const code = (error as { Code?: unknown }).Code;
  if (typeof code !== "string" || code.trim() === "") return null;
  const message = (error as { Message?: unknown }).Message;
  const requestId = (inner as { RequestId?: unknown }).RequestId;
  return {
    code,
    message: typeof message === "string" ? message : "",
    requestId: typeof requestId === "string" ? requestId : undefined,
  };
}

/** 解析 Pages 中的单条元素：字符串（JSON）或对象均兼容，解析失败返回错误原因。 */
export function parsePageEntry(entry: unknown, index: number):
  | { ok: true; page: YuanbaoPage }
  | { ok: false; reason: string } {
  let candidate: unknown = entry;
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    if (trimmed === "") return { ok: false, reason: "空字符串条目" };
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      return { ok: false, reason: "JSON 字符串解析失败" };
    }
  }
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, reason: "条目不是 JSON 对象" };
  }
  const parsed = requireYuanbaoPage(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, reason: `字段校验失败（${issues}）` };
  }
  return { ok: true, page: parsed.data };
}

// 延迟引入避免循环依赖（schema 不依赖 mapper）
import { yuanbaoPageSchema } from "./yuanbao-search.schema";
function requireYuanbaoPage(value: unknown) {
  return yuanbaoPageSchema.safeParse(value);
}

/** normalizeResponse 的共享实现：给定原始 JSON 快照产出统一响应结构。 */
export function normalizeProviderPayload(
  payload: unknown,
  base: Pick<SearchResponse, "requestId" | "provider" | "query" | "searchedAt"> &
    Partial<Pick<SearchResponse, "durationMs" | "httpStatus" | "rawSnapshot">>
): SearchResponse {
  const results: SearchResult[] = [];
  const pageParseErrors: Array<{ index: number; reason: string }> = [];
  let providerRequestId: string | undefined;
  let providerVersion: string | undefined;
  let providerMsg: string | undefined;
  try {
    const envelope = extractProviderEnvelope(payload);
    providerRequestId = envelope.requestId;
    providerVersion = envelope.version;
    providerMsg = envelope.msg;
    envelope.pages.forEach((entry, index) => {
      const parsed = parsePageEntry(entry, index);
      if (!parsed.ok) {
        pageParseErrors.push({ index, reason: parsed.reason });
        return;
      }
      const page = parsed.page;
      if (!page.url || page.url.trim() === "") {
        pageParseErrors.push({ index, reason: "缺少 url 字段，无法作为可追溯证据" });
        return;
      }
      results.push(mapYuanbaoPage(page, index));
    });
  } catch (error) {
    const err = error as Error & { code?: string; providerMessage?: string; missingField?: string };
    return {
      ...base,
      status: "failed",
      results: [],
      providerRequestId,
      providerVersion,
      providerMsg,
      pageParseErrors: pageParseErrors.length > 0 ? pageParseErrors : undefined,
      error: {
        category: err.code
          ? "UNAUTHORIZED_OPERATION_OR_PROVIDER_ERROR"
          : err.missingField
            ? "MISSING_RESPONSE_FIELD"
            : "INVALID_RESPONSE_STRUCTURE",
        code: err.code,
        message: err.providerMessage ?? err.message,
        userMessage: err.missingField
          ? "供应商响应缺少必要字段，已安全失败，未写入任何结果。"
          : "供应商响应结构不符合预期，已安全失败。",
        retryable: false,
        providerRequestId,
        httpStatus: base.httpStatus,
      },
    };
  }
  return {
    ...base,
    status: "success",
    results,
    providerRequestId,
    providerVersion,
    providerMsg,
    pageParseErrors: pageParseErrors.length > 0 ? pageParseErrors : undefined,
  };
}

export function buildSearchRequestSummary(request: SearchRequest): Record<string, unknown> {
  return {
    query: request.query,
    maxResults: request.maxResults,
    mode: request.mode,
    industry: request.industry,
    freshness: request.freshness,
    deeplinks: request.deeplinks,
    siteConfigured: Boolean(request.site),
  };
}
