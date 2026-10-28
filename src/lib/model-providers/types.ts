// 统一大模型 Provider 抽象。
// 首选 OpenAI 兼容 Chat Completions 接口；其他协议需要独立适配器，不假定全网兼容。

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelGenerateOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** 停止信号：生成过程中检查，true 时尽快中止（支持异步判断） */
  isCancelled?: () => boolean | Promise<boolean>;
}

export interface ModelUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface ModelGenerateResult {
  content: string;
  usage?: ModelUsage;
  model: string;
  finishReason?: string;
}

export type ModelErrorCategory =
  | "NOT_CONFIGURED"
  | "DISABLED"
  | "UNAUTHORIZED" // Key 无效
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE" // 无法解析响应
  | "EMPTY_CONTENT" // 模型返回空内容
  | "PROVIDER_ERROR" // 5xx / 未知业务错误
  | "CANCELLED";

export interface ModelErrorPayload {
  category: ModelErrorCategory;
  message: string;
  userMessage: string;
  httpStatus?: number;
  retryable: boolean;
}

export class ModelError extends Error {
  readonly category: ModelErrorCategory;
  readonly userMessage: string;
  readonly httpStatus?: number;
  readonly retryable: boolean;

  constructor(payload: ModelErrorPayload) {
    super(payload.message);
    this.name = "ModelError";
    this.category = payload.category;
    this.userMessage = payload.userMessage;
    this.httpStatus = payload.httpStatus;
    this.retryable = payload.retryable;
  }
}

export interface ModelAdapterInfo {
  provider: string;
  model: string;
  baseUrl: string;
}

/** 统一模型适配器：generate 必须实现；stream 可选。 */
export interface ModelAdapter {
  readonly info: ModelAdapterInfo;
  generate(options: ModelGenerateOptions): Promise<ModelGenerateResult>;
  /** 连接测试：最小请求，产生真实 Token 消耗（费用极小但必须让用户知情）。 */
  testConnection(): Promise<{ success: boolean; durationMs: number; model: string; error?: ModelErrorPayload }>;
}

export function modelErrorFromHttp(status: number, bodyText: string): ModelError {
  let message = `HTTP ${status}`;
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string; code?: string }; message?: string };
    const detail = parsed.error?.message ?? parsed.message;
    if (detail) message = `${message}: ${detail}`;
  } catch {
    // 保留 HTTP 状态码信息
  }
  if (status === 401 || status === 403) {
    return new ModelError({
      category: "UNAUTHORIZED",
      message,
      userMessage: "大模型认证失败：请检查 API Key 是否正确、是否有该模型的访问权限。",
      httpStatus: status,
      retryable: false,
    });
  }
  if (status === 429) {
    return new ModelError({
      category: "RATE_LIMITED",
      message,
      userMessage: "大模型接口限流：请稍后重试，或降低并发。",
      httpStatus: status,
      retryable: true,
    });
  }
  if (status >= 500) {
    return new ModelError({
      category: "PROVIDER_ERROR",
      message,
      userMessage: "大模型服务端错误：可稍后重试。",
      httpStatus: status,
      retryable: true,
    });
  }
  return new ModelError({
    category: "PROVIDER_ERROR",
    message,
    userMessage: `大模型返回异常状态（HTTP ${status}）。`,
    httpStatus: status,
    retryable: false,
  });
}

export function modelErrorFromTransport(error: unknown, timeoutMs: number): ModelError {
  if (error instanceof ModelError) return error;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new ModelError({
      category: "TIMEOUT",
      message: `模型请求超时（>${timeoutMs}ms）`,
      userMessage: "大模型请求超时：请稍后重试或更换模型服务。",
      retryable: true,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ModelError({
    category: "NETWORK_ERROR",
    message: `网络错误: ${message}`,
    userMessage: "无法连接到大模型服务：请检查 Base URL 与服务器网络。",
    retryable: true,
  });
}
