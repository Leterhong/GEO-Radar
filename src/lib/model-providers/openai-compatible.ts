import {
  ModelError,
  modelErrorFromHttp,
  modelErrorFromTransport,
  type ModelAdapter,
  type ModelAdapterInfo,
  type ModelErrorPayload,
  type ModelGenerateOptions,
  type ModelGenerateResult,
} from "./types";

export interface OpenAICompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * OpenAI 兼容 Chat Completions 适配器。
 * 端点：<baseUrl>/chat/completions；认证：Authorization: Bearer <key>。
 * 对话执行采用「搜索 → 生成 → 保存 → 前端轮询」的可靠异步链路，不做流式伪装。
 */
export class OpenAICompatibleAdapter implements ModelAdapter {
  readonly info: ModelAdapterInfo;
  private readonly apiKey: string;
  private readonly temperature: number;
  private readonly maxTokens?: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatibleOptions) {
    const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
    this.info = { provider: "OPENAI_COMPATIBLE", model: options.model, baseUrl };
    this.apiKey = options.apiKey;
    this.temperature = options.temperature ?? 0.4;
    this.maxTokens = options.maxTokens;
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private get model(): string {
    return this.info.model;
  }

  async generate(options: ModelGenerateOptions): Promise<ModelGenerateResult> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // 取消轮询：用户停止后尽快中止底层请求
    const cancelPoller = options.isCancelled
      ? setInterval(() => {
          Promise.resolve(options.isCancelled?.())
            .then((cancelled) => {
              if (cancelled) controller.abort();
            })
            .catch(() => undefined);
        }, 1000)
      : null;
    try {
      const httpResponse = await this.fetchImpl(`${this.info.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: options.messages,
          temperature: options.temperature ?? this.temperature,
          ...(this.maxTokens ? { max_tokens: this.maxTokens } : {}),
        }),
        signal: controller.signal,
      });
      if (!httpResponse.ok) {
        const bodyText = await httpResponse.text();
        throw modelErrorFromHttp(httpResponse.status, bodyText);
      }
      const bodyText = await httpResponse.text();
      let payload: {
        choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      };
      try {
        payload = JSON.parse(bodyText);
      } catch {
        throw new ModelError({
          category: "INVALID_RESPONSE",
          message: "模型响应不是有效 JSON",
          userMessage: "大模型返回了无法解析的响应。",
          retryable: true,
        });
      }
      const choice = payload.choices?.[0];
      const content = choice?.message?.content ?? "";
      if (typeof content !== "string" || content.trim() === "") {
        throw new ModelError({
          category: "EMPTY_CONTENT",
          message: "模型返回空内容",
          userMessage: "大模型返回了空内容：请调整问题或更换模型后重试。",
          retryable: true,
        });
      }
      return {
        content,
        usage: {
          promptTokens: payload.usage?.prompt_tokens,
          completionTokens: payload.usage?.completion_tokens,
        },
        model: payload.model ?? this.model,
        finishReason: choice?.finish_reason,
      };
    } catch (error) {
      throw modelErrorFromTransport(error, timeoutMs);
    } finally {
      clearTimeout(timer);
      if (cancelPoller) clearInterval(cancelPoller);
    }
  }

  /** 连接测试：最小请求，产生少量真实 Token 消耗（UI 已提示）。 */
  async testConnection(): Promise<{
    success: boolean;
    durationMs: number;
    model: string;
    error?: ModelErrorPayload;
  }> {
    const startedAt = Date.now();
    try {
      await this.generate({
        messages: [
          { role: "system", content: "You are a connection test." },
          { role: "user", content: "回复字母 OK 即可。" },
        ],
        maxTokens: 8,
        temperature: 0,
      });
      return { success: true, durationMs: Date.now() - startedAt, model: this.model };
    } catch (error) {
      const payload: ModelErrorPayload =
        error instanceof ModelError
          ? {
              category: error.category,
              message: error.message,
              userMessage: error.userMessage,
              httpStatus: error.httpStatus,
              retryable: error.retryable,
            }
          : {
              category: "PROVIDER_ERROR",
              message: error instanceof Error ? error.message : String(error),
              userMessage: "连接测试失败。",
              retryable: false,
            };
      return { success: false, durationMs: Date.now() - startedAt, model: this.model, error: payload };
    }
  }
}
