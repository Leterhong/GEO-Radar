import type { SearchErrorPayload } from "./types";

export const SEARCH_ERROR_CATEGORIES = {
  NOT_CONFIGURED: "NOT_CONFIGURED",
  DISABLED: "DISABLED",
  UNAUTHORIZED_OPERATION: "UNAUTHORIZED_OPERATION",
  INVALID_PARAMETER: "INVALID_PARAMETER",
  REQUEST_LIMIT_EXCEEDED: "REQUEST_LIMIT_EXCEEDED",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  RESOURCE_UNAVAILABLE: "RESOURCE_UNAVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT: "TIMEOUT",
  INVALID_JSON: "INVALID_JSON",
  MISSING_RESPONSE_FIELD: "MISSING_RESPONSE_FIELD",
  PROVIDER_MSG: "PROVIDER_MSG",
  UNKNOWN: "UNKNOWN",
} as const;

export type SearchErrorCategory =
  (typeof SEARCH_ERROR_CATEGORIES)[keyof typeof SEARCH_ERROR_CATEGORIES];

/** 限流、超时、网络异常与供应商内部错误可重试；认证/参数错误绝不重试。 */
const RETRYABLE_CATEGORIES = new Set<SearchErrorCategory>([
  SEARCH_ERROR_CATEGORIES.REQUEST_LIMIT_EXCEEDED,
  SEARCH_ERROR_CATEGORIES.TIMEOUT,
  SEARCH_ERROR_CATEGORIES.NETWORK_ERROR,
  SEARCH_ERROR_CATEGORIES.INTERNAL_ERROR,
  SEARCH_ERROR_CATEGORIES.RESOURCE_UNAVAILABLE,
]);

export class SearchError extends Error {
  readonly category: SearchErrorCategory;
  readonly code?: string;
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly providerRequestId?: string;
  readonly httpStatus?: number;

  constructor(payload: SearchErrorPayload) {
    super(payload.message);
    this.name = "SearchError";
    this.category = payload.category as SearchErrorCategory;
    this.code = payload.code;
    this.userMessage = payload.userMessage;
    this.retryable = RETRYABLE_CATEGORIES.has(this.category);
    this.providerRequestId = payload.providerRequestId;
    this.httpStatus = payload.httpStatus;
  }

  toPayload(): SearchErrorPayload {
    return {
      category: this.category,
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      retryable: this.retryable,
      providerRequestId: this.providerRequestId,
      httpStatus: this.httpStatus,
    };
  }
}

/** 供应商业务错误码 → 统一错误分类与用户提示 */
export function classifyProviderError(
  code: string,
  message: string,
  providerRequestId?: string,
  httpStatus?: number
): SearchError {
  const trimmedCode = code.trim();
  const map: Record<string, { category: SearchErrorCategory; userMessage: string }> = {
    UnauthorizedOperation: {
      category: SEARCH_ERROR_CATEGORIES.UNAUTHORIZED_OPERATION,
      userMessage: "认证或授权失败：请检查元宝搜索 API Key 是否正确、是否已授予访问权限。",
    },
    InvalidParameter: {
      category: SEARCH_ERROR_CATEGORIES.INVALID_PARAMETER,
      userMessage: "请求参数错误：请检查搜索参数设置是否符合当前套餐的支持范围。",
    },
    RequestLimitExceeded: {
      category: SEARCH_ERROR_CATEGORIES.REQUEST_LIMIT_EXCEEDED,
      userMessage: "已触发请求频率限制：系统将自动退避重试，或请稍后再执行任务。",
    },
    ResourceNotFound: {
      category: SEARCH_ERROR_CATEGORIES.RESOURCE_NOT_FOUND,
      userMessage: "元宝搜索服务尚未开通或资源不存在：请先在腾讯云控制台开通服务并完成购买。",
    },
    ResourceUnavailable: {
      category: SEARCH_ERROR_CATEGORIES.RESOURCE_UNAVAILABLE,
      userMessage: "服务资源不可用：请检查账号是否欠费或服务状态。",
    },
    InternalError: {
      category: SEARCH_ERROR_CATEGORIES.INTERNAL_ERROR,
      userMessage: "供应商内部错误：系统将自动重试，若持续失败请联系服务方。",
    },
  };
  const entry = map[trimmedCode] ?? {
    category: SEARCH_ERROR_CATEGORIES.UNKNOWN,
    userMessage: `供应商返回未知错误（${trimmedCode}）：${message || "无详细信息"}`,
  };
  return new SearchError({
    category: entry.category,
    code: trimmedCode || undefined,
    message: message ? `${trimmedCode}: ${message}` : trimmedCode,
    userMessage: entry.userMessage,
    retryable: true,
    providerRequestId,
    httpStatus,
  });
}

export function searchErrorFrom(
  category: SearchErrorCategory,
  message: string,
  userMessage: string,
  opts?: { providerRequestId?: string; httpStatus?: number; code?: string }
): SearchError {
  return new SearchError({
    category,
    message,
    userMessage,
    code: opts?.code,
    providerRequestId: opts?.providerRequestId,
    httpStatus: opts?.httpStatus,
    retryable: true,
  });
}

export function nonRetryable(
  category: SearchErrorCategory,
  message: string,
  userMessage: string,
  opts?: { providerRequestId?: string; httpStatus?: number; code?: string }
): SearchError {
  const error = searchErrorFrom(category, message, userMessage, opts);
  (error as unknown as { retryable: boolean }).retryable = false;
  return error;
}
