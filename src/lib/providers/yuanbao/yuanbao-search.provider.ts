import { env } from "@/lib/env";
import type {
  ConfigValidationResult,
  ConnectionTestResult,
  ProviderStatus,
  SearchProvider,
  SearchRequest,
  SearchResponse,
} from "@/lib/providers/types";
import {
  SEARCH_ERROR_CATEGORIES,
  SearchError,
  classifyProviderError,
  nonRetryable,
  searchErrorFrom,
} from "@/lib/providers/errors";
import { extractBusinessError } from "./yuanbao-search.mapper";
import {
  buildYuanbaoRequestBody,
  yuanbaoQuerySchema,
  yuanbaoSearchParamsSchema,
} from "./yuanbao-search.schema";
import { normalizeProviderPayload } from "./yuanbao-search.mapper";
import { logger } from "@/server/security/logger";
import { registerSecret } from "@/server/security/logger";

export interface YuanbaoProviderOptions {
  /** 解密后的 API Key；未配置时为 undefined（此时一切真实请求被阻止） */
  apiKey?: string;
  /** 覆盖 endpoint 仅用于测试环境指向 Mock Server；默认使用官方地址 */
  endpoint?: string;
  /** 凭据当前是否可用（CONNECTED） */
  credentialConnected: boolean;
  /** 全局启用开关 YUANBAO_SEARCH_ENABLED */
  globallyEnabled: boolean;
  timeoutMs?: number;
  /** 注入 fetch 用于测试；默认全局 fetch */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30000;
const CONNECTION_TEST_QUERY = "GEO Radar 连接测试";

/**
 * 元宝搜索 Provider（服务 API Key 方式）。
 * 协议：POST {endpoint}，Authorization: Bearer <API_KEY>，Content-Type: application/json; charset=UTF-8。
 * 不使用腾讯云标准签名的 wsa.tencentcloudapi.com / X-TC-Action / Version 方式。
 */
export class YuanbaoSearchProvider implements SearchProvider {
  readonly name = "YUANBAO" as const;
  private readonly apiKey?: string;
  private readonly endpoint: string;
  private readonly credentialConnected: boolean;
  private readonly globallyEnabled: boolean;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: YuanbaoProviderOptions) {
    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint ?? env.yuanbaoSearchEndpoint;
    this.credentialConnected = options.credentialConnected;
    this.globallyEnabled = options.globallyEnabled;
    this.timeoutMs = options.timeoutMs ?? env.searchTimeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
    // 注册到日志脱敏器，任何日志输出都会被替换
    registerSecret(this.apiKey);
  }

  async getStatus(): Promise<ProviderStatus> {
    const configured = Boolean(this.apiKey) && isOfficialEndpoint(this.endpoint);
    return {
      provider: this.name,
      configured,
      connected: configured && this.credentialConnected,
      enabled: this.globallyEnabled && configured,
      isMock: false,
      detail: !this.globallyEnabled
        ? "元宝搜索数据源未启用（YUANBAO_SEARCH_ENABLED=false）"
        : !this.apiKey
          ? "尚未配置 API Key"
          : this.credentialConnected
            ? "已通过真实连接测试"
            : "已保存密钥但尚未通过连接测试",
    };
  }

  async validateConfig(config: { apiKey?: string }): Promise<ConfigValidationResult> {
    const errors: string[] = [];
    if (!config.apiKey || config.apiKey.trim() === "") {
      errors.push("API Key 不能为空");
    } else if (config.apiKey.length < 8) {
      errors.push("API Key 长度不符合预期，请确认是否复制完整");
    }
    if (!isOfficialEndpoint(this.endpoint)) {
      errors.push(
        "当前 YUANBAO_SEARCH_ENDPOINT 指向非官方地址，仅允许在测试环境使用；生产环境必须移除该覆盖"
      );
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * 连接测试：使用已保存密钥发起一次真实最小搜索请求（Query-only，兼容所有版本）。
   * 会产生真实计费调用；只有真实成功响应才返回 success。
   */
  async testConnection(): Promise<ConnectionTestResult> {
    const guard = this.precheck({ forConnectionTest: true });
    if (guard) {
      return {
        success: false,
        provider: this.name,
        testedAt: new Date().toISOString(),
        error: guard.toPayload(),
        madeRealRequest: false,
      };
    }
    const startedAt = Date.now();
    try {
      const response = await this.runSearch(
        {
          query: CONNECTION_TEST_QUERY,
          requestId: `conn-test-${Date.now()}`,
        },
        true
      );
      const durationMs = Date.now() - startedAt;
      if (response.status === "failed" && response.error) {
        return {
          success: false,
          provider: this.name,
          testedAt: new Date().toISOString(),
          durationMs,
          error: response.error,
          madeRealRequest: response.httpStatus !== undefined,
        };
      }
      return {
        success: true,
        provider: this.name,
        testedAt: new Date().toISOString(),
        durationMs,
        providerRequestId: response.providerRequestId,
        providerVersion: response.providerVersion,
        resultCount: response.results.length,
        madeRealRequest: true,
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const payload =
        error instanceof SearchError
          ? error.toPayload()
          : {
              category: SEARCH_ERROR_CATEGORIES.UNKNOWN,
              message: error instanceof Error ? error.message : String(error),
              userMessage: "连接测试失败，请稍后重试。",
              retryable: false,
            };
      return {
        success: false,
        provider: this.name,
        testedAt: new Date().toISOString(),
        durationMs,
        error: payload,
        madeRealRequest: false,
      };
    }
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    return this.runSearch(request, false);
  }

  /**
   * 内部执行器。
   * @param skipConnectedCheck 连接测试场景为 true：此时尚未"通过测试"，
   *   若仍走「必须已连接」守卫会形成死锁。
   */
  private async runSearch(request: SearchRequest, skipConnectedCheck: boolean): Promise<SearchResponse> {
    const base = {
      requestId: request.requestId,
      provider: this.name,
      query: request.query,
      searchedAt: new Date().toISOString(),
    };
    const guard = this.precheck({ forConnectionTest: skipConnectedCheck });
    if (guard) {
      return {
        ...base,
        status: "failed",
        results: [],
        error: guard.toPayload(),
      };
    }

    const params = yuanbaoSearchParamsSchema.safeParse({
      query: request.query,
      mode: request.mode,
      site: request.site,
      maxResults: request.maxResults,
      industry: request.industry,
      freshness: request.freshness,
      deeplinks: request.deeplinks,
    });
    if (!params.success) {
      const detail = params.error.issues.map((i) => i.message).join("; ");
      const error = nonRetryable(
        SEARCH_ERROR_CATEGORIES.INVALID_PARAMETER,
        `搜索参数校验失败: ${detail}`,
        `搜索参数不正确：${detail}`
      );
      return { ...base, status: "failed", results: [], error: error.toPayload() };
    }
    const built = buildYuanbaoRequestBody(params.data);
    if ("error" in built) {
      const error = nonRetryable(
        SEARCH_ERROR_CATEGORIES.INVALID_PARAMETER,
        `搜索参数校验失败: ${built.error}`,
        `搜索参数不正确：${built.error}`
      );
      return { ...base, status: "failed", results: [], error: error.toPayload() };
    }

    const startedAt = Date.now();
    try {
      const httpResponse = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify(built.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const durationMs = Date.now() - startedAt;
      const responseText = await httpResponse.text();

      if (!httpResponse.ok) {
        const error = classifyHttpError(httpResponse.status, responseText);
        logger.warn("[yuanbao] 供应商返回 HTTP 错误", {
          status: httpResponse.status,
          category: error.category,
          requestId: request.requestId,
        });
        return {
          ...base,
          status: "failed",
          results: [],
          durationMs,
          httpStatus: httpResponse.status,
          error: error.toPayload(),
        };
      }

      let payload: unknown;
      try {
        payload = JSON.parse(responseText);
      } catch {
        const error = searchErrorFrom(
          SEARCH_ERROR_CATEGORIES.INVALID_JSON,
          "供应商响应不是有效 JSON",
          "供应商返回了无法解析的响应，已安全失败。",
          { httpStatus: httpResponse.status }
        );
        (error as unknown as { retryable: boolean }).retryable = true;
        return {
          ...base,
          status: "failed",
          results: [],
          durationMs,
          httpStatus: httpResponse.status,
          error: error.toPayload(),
          rawSnapshot: truncateSnapshot(responseText).text,
          rawSnapshotTruncated: truncateSnapshot(responseText).truncated,
        };
      }

      // 官方接口在业务失败时仍返回 HTTP 200，错误信息位于 Response.Error
      const businessError = extractBusinessError(payload);
      if (businessError) {
        const classified = classifyProviderError(
          businessError.code,
          businessError.message,
          businessError.requestId,
          httpResponse.status
        );
        logger.warn("[yuanbao] 业务错误（HTTP 200 包裹）", {
          code: businessError.code,
          requestId: request.requestId,
        });
        return {
          ...base,
          status: "failed",
          results: [],
          durationMs,
          httpStatus: httpResponse.status,
          providerRequestId: businessError.requestId,
          error: classified.toPayload(),
          rawSnapshot: truncateSnapshot(responseText).text,
          rawSnapshotTruncated: truncateSnapshot(responseText).truncated,
        };
      }

      const normalized = normalizeProviderPayload(payload, {
        ...base,
        durationMs,
        httpStatus: httpResponse.status,
        rawSnapshot: truncateSnapshot(responseText).text,
      });
      if (normalized.status === "failed" && normalized.error) {
        logger.warn("[yuanbao] 响应结构校验失败", {
          category: normalized.error.category,
          requestId: request.requestId,
        });
      } else if (normalized.providerMsg) {
        logger.info("[yuanbao] 供应商返回 Msg", { msg: normalized.providerMsg, requestId: request.requestId });
      }
      return normalized;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const searchErr = classifyTransportError(error, this.timeoutMs);
      logger.warn("[yuanbao] 请求传输失败", {
        category: searchErr.category,
        requestId: request.requestId,
        durationMs,
      });
      return {
        ...base,
        status: "failed",
        results: [],
        durationMs,
        error: searchErr.toPayload(),
      };
    }
  }

  /** normalizeResponse：把任意原始响应载荷规范化（供复用与测试）。 */
  normalizeResponse(response: unknown): SearchResponse {
    return normalizeProviderPayload(response, {
      requestId: "normalize-adhoc",
      provider: this.name,
      query: "",
      searchedAt: new Date().toISOString(),
    });
  }

  /**
   * 前置守卫。
   * @param options.forConnectionTest 连接测试时必须跳过「已通过连接测试」这一条，
   *   否则会出现"必须先连接成功才能测连接"的死锁。
   */
  private precheck(options?: { forConnectionTest?: boolean }): SearchError | null {
    if (!this.globallyEnabled) {
      return nonRetryable(
        SEARCH_ERROR_CATEGORIES.DISABLED,
        "元宝搜索数据源未启用（YUANBAO_SEARCH_ENABLED=false）",
        "元宝搜索数据源当前未启用，请在服务端环境变量中开启后再使用。"
      );
    }
    if (!this.apiKey) {
      return nonRetryable(
        SEARCH_ERROR_CATEGORIES.NOT_CONFIGURED,
        "缺少 API Key，未发起任何真实请求",
        "元宝搜索尚未配置 API Key：请先在“设置 → 数据源”中完成配置并测试连接。"
      );
    }
    if (!options?.forConnectionTest && !this.credentialConnected) {
      return nonRetryable(
        SEARCH_ERROR_CATEGORIES.NOT_CONFIGURED,
        "数据源尚未通过真实连接测试，阻止真实搜索",
        "数据源尚未通过连接测试：请先在设置页完成“测试连接”。"
      );
    }
    return null;
  }
}

function isOfficialEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.hostname === "api.wsa.cloud.tencent.com" || url.hostname === "api.wsa.tencent.com";
  } catch {
    return false;
  }
}

function truncateSnapshot(text: string): { text: string; truncated: boolean } {
  const MAX_BYTES = 256 * 1024;
  const truncated = text.length > MAX_BYTES;
  return { text: truncated ? text.slice(0, MAX_BYTES) : text, truncated };
}

export function classifyHttpError(status: number, bodyText: string): SearchError {
  let code: string | undefined;
  let message: string | undefined;
  let requestId: string | undefined;
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const inner = (parsed.Response ?? parsed) as Record<string, unknown>;
    const err = inner.Error as { Code?: unknown; Message?: unknown } | undefined;
    if (err && typeof err === "object") {
      if (typeof err.Code === "string") code = err.Code;
      if (typeof err.Message === "string") message = err.Message;
    }
    if (typeof inner.Code === "string" && !code) {
      code = inner.Code;
      if (typeof inner.Message === "string") message = inner.Message;
    }
    if (typeof inner.RequestId === "string") requestId = inner.RequestId;
  } catch {
    // body 不是 JSON：仅依赖 HTTP 状态码
  }
  if (code) return classifyProviderError(code, message ?? "", requestId, status);
  if (status === 401 || status === 403) {
    return classifyProviderError("UnauthorizedOperation", message ?? `HTTP ${status}`, requestId, status);
  }
  if (status === 429) {
    return classifyProviderError("RequestLimitExceeded", message ?? `HTTP ${status}`, requestId, status);
  }
  if (status === 404) {
    return classifyProviderError("ResourceNotFound", message ?? `HTTP ${status}`, requestId, status);
  }
  if (status >= 500) {
    return classifyProviderError("InternalError", message ?? `HTTP ${status}`, requestId, status);
  }
  return searchErrorFrom(
    SEARCH_ERROR_CATEGORIES.UNKNOWN,
    `供应商返回 HTTP ${status}`,
    `供应商返回异常状态（HTTP ${status}），已安全失败。`,
    { httpStatus: status, providerRequestId: requestId }
  );
}

export function classifyTransportError(error: unknown, timeoutMs: number): SearchError {
  if (error instanceof Error && error.name === "TimeoutError") {
    return searchErrorFrom(
      SEARCH_ERROR_CATEGORIES.TIMEOUT,
      `请求超时（>${timeoutMs}ms）`,
      "搜索请求超时：供应商未在限定时间内返回，可稍后重试。"
    );
  }
  if (error instanceof Error && error.name === "AbortError") {
    return searchErrorFrom(
      SEARCH_ERROR_CATEGORIES.TIMEOUT,
      "请求被中止（超时）",
      "搜索请求超时：可稍后重试。"
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return searchErrorFrom(
    SEARCH_ERROR_CATEGORIES.NETWORK_ERROR,
    `网络错误: ${message}`,
    "网络异常：无法连接到元宝搜索服务，请检查服务器网络后重试。"
  );
}
