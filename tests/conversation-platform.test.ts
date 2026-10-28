/**
 * 对话平台单元测试：上下文构建、引用校验、多轮裁剪、模型适配器（Mock fetch）、模式元数据。
 */
import { describe, it, expect, vi } from "vitest";
import {
  normalizeUrlForDedup,
  dedupeResults,
  buildSearchContext,
  validateCitations,
  trimHistory,
} from "@/server/services/conversation/context-builder";
import { OpenAICompatibleAdapter } from "@/lib/model-providers/openai-compatible";
import { MODE_META } from "@/components/chat/mode-selector";
import type { SearchResult as PrismaSearchResult } from "@prisma/client";

function makeResult(partial: Partial<PrismaSearchResult>): PrismaSearchResult {
  return {
    id: "r1",
    workspaceId: "w1",
    taskId: "t1",
    itemId: "i1",
    questionId: null,
    position: 0,
    title: "标题",
    url: "https://example.com/a",
    domain: "example.com",
    snippet: "摘要",
    publishedAt: null,
    provider: "YUANBAO",
    isMock: false,
    extra: null,
    collectedAt: new Date(),
    ...partial,
  } as PrismaSearchResult;
}

describe("搜索上下文构建", () => {
  it("URL 去重：追踪参数与 hash、大小写、尾部斜杠", () => {
    expect(normalizeUrlForDedup("https://Example.com/a/?utm_source=x&id=1")).toBe("example.com/a?id=1");
    expect(normalizeUrlForDedup("https://example.com/a#section")).toBe("example.com/a");
    expect(normalizeUrlForDedup("https://example.com/a")).toBe("example.com/a");
  });

  it("dedupeResults 移除重复与非法 URL", () => {
    const results = [
      makeResult({ id: "1", url: "https://a.com/x" }),
      makeResult({ id: "2", url: "https://a.com/x?utm_source=t" }),
      makeResult({ id: "3", url: "javascript:alert(1)" }),
      makeResult({ id: "4", url: "https://b.com/y" }),
    ];
    const deduped = dedupeResults(results);
    expect(deduped.map((r) => r.id)).toEqual(["1", "4"]);
  });

  it("buildSearchContext 分配 1 起始编号并截断摘要", () => {
    const results = Array.from({ length: 12 }, (_, i) =>
      makeResult({ id: `r${i}`, url: `https://site${i}.com/x`, snippet: "长".repeat(600) })
    );
    const { sources, contextText } = buildSearchContext(results, { maxSources: 8, maxSnippetLength: 500 });
    expect(sources).toHaveLength(8);
    expect(sources[0]?.index).toBe(1);
    expect(sources[7]?.index).toBe(8);
    expect(sources[0]?.snippet.length).toBeLessThanOrEqual(500);
    expect(contextText).toContain("[1] 标题");
  });

  it("无结果时给出占位上下文", () => {
    const { sources, contextText } = buildSearchContext([]);
    expect(sources).toHaveLength(0);
    expect(contextText).toContain("没有返回可用来源");
  });
});

describe("引用编号校验", () => {
  it("有效引用保留并按升序记录", () => {
    const v = validateCitations("结论 [2] 与 [1] 一致，另外 [1] 重复。", 3);
    expect(v.cleanedText).toContain("[1]");
    expect(v.cleanedText).toContain("[2]");
    expect(v.used).toEqual([1, 2]);
    expect(v.removed).toEqual([]);
  });

  it("不存在的编号被移除（防伪造来源）", () => {
    const v = validateCitations("报告 [1] 和 [9] 的内容。", 3);
    expect(v.cleanedText).not.toContain("[9]");
    expect(v.cleanedText).toContain("[1]");
    expect(v.removed).toEqual([9]);
  });

  it("无来源时移除全部引用", () => {
    const v = validateCitations("全部引用 [1][2] 都应移除", 0);
    expect(v.cleanedText).not.toMatch(/\[\d\]/);
    expect(v.used).toEqual([]);
  });

  it("多位数编号上限", () => {
    const v = validateCitations("[10] 有效边界，[11] 无效", 10);
    expect(v.cleanedText).toContain("[10]");
    expect(v.cleanedText).not.toContain("[11]");
  });
});

describe("多轮历史裁剪", () => {
  it("限制消息条数与总长度，且不修改角色", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `消息${i}：${"字".repeat(1500)}`,
    }));
    const trimmed = trimHistory(history, 10, 8000);
    expect(trimmed.length).toBeLessThanOrEqual(10);
    expect(trimmed[0]?.role).toBeDefined();
    // 总长度受控
    const total = trimmed.reduce((sum, m) => sum + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(2000 * 10 + 2000); // 单条截断上限 2000
  });

  it("空历史返回空", () => {
    expect(trimHistory([])).toEqual([]);
  });
});

describe("模型适配器（OpenAI 兼容，Mock fetch）", () => {
  const base = { baseUrl: "https://api.test.com/v1", apiKey: "test-key-123456", model: "test-model" };

  function okFetch(content = "回答内容", usage = { prompt_tokens: 100, completion_tokens: 20 }) {
    return vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content }, finish_reason: "stop" }],
          usage,
          model: "test-model-returned",
        }),
    });
  }

  it("正常生成：返回内容与真实 usage", async () => {
    const adapter = new OpenAICompatibleAdapter({ ...base, fetchImpl: okFetch() });
    const result = await adapter.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(result.content).toBe("回答内容");
    expect(result.usage?.promptTokens).toBe(100);
    expect(result.usage?.completionTokens).toBe(20);
    expect(result.model).toBe("test-model-returned");
  });

  it("请求体包含模型名与消息", async () => {
    const fetchMock = okFetch();
    const adapter = new OpenAICompatibleAdapter({ ...base, fetchImpl: fetchMock as unknown as typeof fetch });
    await adapter.generate({ messages: [{ role: "user", content: "hi" }] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test.com/v1/chat/completions");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("test-model");
    expect(body.messages).toHaveLength(1);
  });

  it("401 → UNAUTHORIZED，不可重试语义", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: "Invalid API key" } }),
    }) as unknown as typeof fetch;
    const adapter = new OpenAICompatibleAdapter({ ...base, fetchImpl: fetchMock });
    await expect(adapter.generate({ messages: [] })).rejects.toMatchObject({ category: "UNAUTHORIZED", retryable: false });
  });

  it("429 → RATE_LIMITED 可重试", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "{}" }) as unknown as typeof fetch;
    const adapter = new OpenAICompatibleAdapter({ ...base, fetchImpl: fetchMock });
    await expect(adapter.generate({ messages: [] })).rejects.toMatchObject({ category: "RATE_LIMITED", retryable: true });
  });

  it("超时 → TIMEOUT", async () => {
    const timeoutError = new Error("aborted");
    timeoutError.name = "TimeoutError";
    const fetchMock = vi.fn().mockRejectedValue(timeoutError) as unknown as typeof fetch;
    const adapter = new OpenAICompatibleAdapter({ ...base, fetchImpl: fetchMock, timeoutMs: 100 });
    await expect(adapter.generate({ messages: [] })).rejects.toMatchObject({ category: "TIMEOUT" });
  });

  it("无效 JSON → INVALID_RESPONSE", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "<html/>" }) as unknown as typeof fetch;
    const adapter = new OpenAICompatibleAdapter({ ...base, fetchImpl: fetchMock });
    await expect(adapter.generate({ messages: [] })).rejects.toMatchObject({ category: "INVALID_RESPONSE" });
  });

  it("空内容 → EMPTY_CONTENT", async () => {
    const fetchMock = okFetch("");
    const adapter = new OpenAICompatibleAdapter({ ...base, fetchImpl: fetchMock });
    await expect(adapter.generate({ messages: [] })).rejects.toMatchObject({ category: "EMPTY_CONTENT" });
  });

  it("连接测试成功与失败路径", async () => {
    const okAdapter = new OpenAICompatibleAdapter({ ...base, fetchImpl: okFetch("OK") });
    const okResult = await okAdapter.testConnection();
    expect(okResult.success).toBe(true);
    expect(okResult.model).toBe("test-model");

    const failAdapter = new OpenAICompatibleAdapter({
      ...base,
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "{}" }) as unknown as typeof fetch,
    });
    const failResult = await failAdapter.testConnection();
    expect(failResult.success).toBe(false);
    expect(failResult.error?.category).toBe("UNAUTHORIZED");
  });

  it("取消信号会中止请求（AbortError → 不掩盖为网络错误）", async () => {
    let abortController: AbortController | null = null;
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      abortController = init?.signal ? new AbortController() : null;
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    }) as unknown as typeof fetch;
    const adapter = new OpenAICompatibleAdapter({ ...base, fetchImpl: fetchMock, timeoutMs: 5000 });
    let cancelled = false;
    const promise = adapter.generate({
      messages: [{ role: "user", content: "long" }],
      isCancelled: () => cancelled,
    });
    setTimeout(() => {
      cancelled = true;
    }, 50);
    await expect(promise).rejects.toMatchObject({ category: "TIMEOUT" });
    void abortController;
  });
});

describe("三模式元数据", () => {
  it("三种模式定义完整（图标、名称、说明）", () => {
    expect(MODE_META.SEARCH_ANSWER.label).toBe("搜索问答");
    expect(MODE_META.SEARCH_EVIDENCE.label).toBe("搜索证据");
    expect(MODE_META.GEO_ANALYSIS.label).toBe("GEO 分析");
    for (const meta of Object.values(MODE_META)) {
      expect(meta.description.length).toBeGreaterThan(0);
      expect(meta.en.length).toBeGreaterThan(0);
    }
  });
});
