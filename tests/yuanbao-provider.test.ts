/**
 * 元宝搜索 Provider 单元测试（Mock fetch，不发起真实请求）。
 * 覆盖开发指令第十节要求的 15 个场景。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { YuanbaoSearchProvider } from "@/lib/providers/yuanbao/yuanbao-search.provider";
import { SEARCH_ERROR_CATEGORIES } from "@/lib/providers/errors";
import { redact, registerSecret, clearRegisteredSecrets } from "@/server/security/logger";
import { maskSecret, encryptSecret, decryptSecret, CredentialEncryptionError } from "@/server/security/crypto";

const TEST_ENDPOINT = "https://api.wsa.cloud.tencent.com/SearchPro";

function okResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function makeProvider(fetchImpl: typeof fetch, apiKey = "test-api-key-1234567890") {
  return new YuanbaoSearchProvider({
    apiKey,
    endpoint: TEST_ENDPOINT,
    credentialConnected: true,
    globallyEnabled: true,
    timeoutMs: 5000,
    fetchImpl,
  });
}

const samplePage = {
  title: "什么是 GEO？",
  url: "https://www.example.com/geo-intro",
  date: "2026-01-15",
  passage: "GEO 是生成式引擎优化的缩写。",
  site: "示例站",
  score: 0.87,
};

beforeEach(() => {
  clearRegisteredSecrets();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("YuanbaoSearchProvider", () => {
  it("场景1：正常请求返回解析后的结果与元数据", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        Response: {
          Query: "什么是 GEO",
          Pages: [JSON.stringify(samplePage)],
          RequestId: "req-abc-123",
          Version: "standard",
          Msg: "",
        },
      })
    );
    const provider = makeProvider(fetchMock as unknown as typeof fetch);
    const res = await provider.search({ query: "什么是 GEO", requestId: "r1" });
    expect(res.status).toBe("success");
    expect(res.results).toHaveLength(1);
    expect(res.results[0]?.title).toBe("什么是 GEO？");
    expect(res.results[0]?.domain).toBe("www.example.com");
    expect(res.results[0]?.score).toBe(0.87);
    expect(res.providerRequestId).toBe("req-abc-123");
    expect(res.providerVersion).toBe("standard");
    // 请求头与请求体正确
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TEST_ENDPOINT);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-api-key-1234567890");
    expect(headers["Content-Type"]).toBe("application/json; charset=UTF-8");
    const body = JSON.parse(init.body as string);
    expect(body.Query).toBe("什么是 GEO");
    expect(body.Mode).toBeUndefined();
    expect(body.Cnt).toBeUndefined();
  });

  it("场景2：缺少 API Key 时不发起任何 HTTP 请求", async () => {
    const fetchMock = vi.fn();
    const provider = new YuanbaoSearchProvider({
      endpoint: TEST_ENDPOINT,
      credentialConnected: true,
      globallyEnabled: true,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const res = await provider.search({ query: "test", requestId: "r2" });
    expect(res.status).toBe("failed");
    expect(res.error?.category).toBe(SEARCH_ERROR_CATEGORIES.NOT_CONFIGURED);
    expect(fetchMock).not.toHaveBeenCalled();
    const test = await provider.testConnection();
    expect(test.success).toBe(false);
    expect(test.madeRealRequest).toBe(false);
  });

  it("场景3：认证失败（UnauthorizedOperation）不可重试", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      {
        ok: false,
        status: 401,
        text: async () =>
          JSON.stringify({ Response: { Error: { Code: "UnauthorizedOperation", Message: "API KEY 不正确" }, RequestId: "req-401" } }),
      } as Response
    );
    const provider = makeProvider(fetchMock as unknown as typeof fetch);
    const res = await provider.search({ query: "test", requestId: "r3" });
    expect(res.status).toBe("failed");
    expect(res.error?.category).toBe(SEARCH_ERROR_CATEGORIES.UNAUTHORIZED_OPERATION);
    expect(res.error?.retryable).toBe(false);
    expect(res.error?.code).toBe("UnauthorizedOperation");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("场景4：参数错误（InvalidParameter）不重试", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      {
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ Response: { Error: { Code: "InvalidParameter", Message: "Cnt 值不合法" } } }),
      } as Response
    );
    const provider = makeProvider(fetchMock as unknown as typeof fetch);
    const res = await provider.search({ query: "test", requestId: "r4" });
    expect(res.error?.category).toBe(SEARCH_ERROR_CATEGORIES.INVALID_PARAMETER);
    expect(res.error?.retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("场景5：触发限流（RequestLimitExceeded）标记为可重试", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      {
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ Response: { Error: { Code: "RequestLimitExceeded", Message: "超过频率限制" } } }),
      } as Response
    );
    const provider = makeProvider(fetchMock as unknown as typeof fetch);
    const res = await provider.search({ query: "test", requestId: "r5" });
    expect(res.error?.category).toBe(SEARCH_ERROR_CATEGORIES.REQUEST_LIMIT_EXCEEDED);
    expect(res.error?.retryable).toBe(true);
  });

  it("场景6：服务未开通（ResourceNotFound）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      {
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ Response: { Error: { Code: "ResourceNotFound", Message: "用户资源未开通" } } }),
      } as Response
    );
    const provider = makeProvider(fetchMock as unknown as typeof fetch);
    const res = await provider.search({ query: "test", requestId: "r6" });
    expect(res.error?.category).toBe(SEARCH_ERROR_CATEGORIES.RESOURCE_NOT_FOUND);
    expect(res.error?.userMessage).toContain("开通");
  });

  it("场景7：请求超时", async () => {
    const timeoutError = new Error("The operation was aborted due to timeout");
    timeoutError.name = "TimeoutError";
    const fetchMock = vi.fn().mockRejectedValue(timeoutError);
    const provider = makeProvider(fetchMock as unknown as typeof fetch);
    const res = await provider.search({ query: "test", requestId: "r7" });
    expect(res.status).toBe("failed");
    expect(res.error?.category).toBe(SEARCH_ERROR_CATEGORIES.TIMEOUT);
    expect(res.error?.retryable).toBe(true);
  });

  it("场景8：网络异常", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.wsa.cloud.tencent.com"));
    const provider = makeProvider(fetchMock as unknown as typeof fetch);
    const res = await provider.search({ query: "test", requestId: "r8" });
    expect(res.error?.category).toBe(SEARCH_ERROR_CATEGORIES.NETWORK_ERROR);
    expect(res.error?.retryable).toBe(true);
  });

  it("场景9：无效 JSON 安全失败", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "<html>Bad Gateway</html>",
    } as Response);
    const provider = makeProvider(fetchMock as unknown as typeof fetch);
    const res = await provider.search({ query: "test", requestId: "r9" });
    expect(res.status).toBe("failed");
    expect(res.error?.category).toBe(SEARCH_ERROR_CATEGORIES.INVALID_JSON);
    expect(res.rawSnapshot).toContain("Bad Gateway");
  });

  it("场景10：Pages 单条解析失败不影响其余有效结果", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        Response: {
          Query: "q",
          Pages: [
            JSON.stringify(samplePage),
            "这不是JSON{{{",
            JSON.stringify({ title: "无URL的结果" }),
            JSON.stringify({ ...samplePage, url: "https://second.example.com/x" }),
          ],
          RequestId: "req-partial",
        },
      })
    );
    const provider = makeProvider(fetchMock as unknown as typeof fetch);
    const res = await provider.search({ query: "q", requestId: "r10" });
    expect(res.status).toBe("success");
    expect(res.results).toHaveLength(2);
    expect(res.results[1]?.url).toBe("https://second.example.com/x");
    expect(res.pageParseErrors).toHaveLength(2);
    expect(res.pageParseErrors?.[0]?.index).toBe(1);
    expect(res.pageParseErrors?.[1]?.reason).toContain("url");
  });

  it("场景11：缺少可选字段时不伪造值", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        Response: {
          Query: "q",
          Pages: [JSON.stringify({ url: "https://minimal.example.com/a", title: "" })],
        },
      })
    );
    const provider = makeProvider(fetchMock as unknown as typeof fetch);
    const res = await provider.search({ query: "q", requestId: "r11" });
    expect(res.status).toBe("success");
    const result = res.results[0];
    expect(result).toBeDefined();
    expect(result?.score).toBeUndefined();
    expect(result?.authorityLevel).toBeUndefined();
    expect(result?.publishedAt).toBeUndefined();
    expect(result?.snippet).toBeUndefined();
    expect(result?.pics).toBeUndefined();
    expect(result?.deeplinks).toBeUndefined();
  });

  it("场景12：供应商返回 RequestId 被完整保留", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ Response: { Query: "q", Pages: [], RequestId: "req-xyz-999", Version: "flagship" } })
    );
    const provider = makeProvider(fetchMock as unknown as typeof fetch);
    const res = await provider.search({ query: "q", requestId: "r12" });
    expect(res.providerRequestId).toBe("req-xyz-999");
    expect(res.providerVersion).toBe("flagship");
  });

  it("场景13：API Key 不出现在日志输出中", async () => {
    const secret = "sk-live-secret-abc12345";
    registerSecret(secret);
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // 请求头中的密钥经过 redact 处理
    const redacted = redact(`Authorization: Bearer ${secret} status=401`);
    expect(redacted).not.toContain(secret);
    expect(redacted).toContain("Bearer [REDACTED]");
    // 掩码函数只暴露首尾
    const masked = maskSecret(secret);
    expect(masked.startsWith("sk-l")).toBe(true);
    expect(masked.endsWith("2345")).toBe(true);
    expect(masked).toContain("••••");
    expect(masked.length).toBeLessThan(secret.length);
    consoleSpy.mockRestore();
  });

  it("场景13b：掩码后的配置结构中不存在完整密钥字段", async () => {
    // 模拟前端可获得的配置对象形态：只允许 maskedKey
    const maskedKey = maskSecret("sk-live-secret-abc12345");
    const frontendConfig = {
      configured: true,
      status: "CONNECTED",
      maskedKey,
    };
    expect(JSON.stringify(frontendConfig)).not.toContain("sk-live-secret-abc12345");
  });

  it("场景14/15：未通过连接测试或已禁用的数据源会阻止真实搜索（守卫逻辑）", async () => {
    // 通过 provider 状态与 precheck 验证：credentialConnected=false 时阻止真实请求
    const fetchMock = vi.fn();
    const provider = new YuanbaoSearchProvider({
      apiKey: "key-1234567890",
      endpoint: TEST_ENDPOINT,
      credentialConnected: false,
      globallyEnabled: true,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const status = await provider.getStatus();
    expect(status.configured).toBe(true);
    expect(status.connected).toBe(false);
    const res = await provider.search({ query: "test", requestId: "r14" });
    expect(res.status).toBe("failed");
    expect(res.error?.category).toBe(SEARCH_ERROR_CATEGORIES.NOT_CONFIGURED);
    expect(fetchMock).not.toHaveBeenCalled();

    // 全局开关关闭
    const providerDisabled = new YuanbaoSearchProvider({
      apiKey: "key-1234567890",
      endpoint: TEST_ENDPOINT,
      credentialConnected: true,
      globallyEnabled: false,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const res2 = await providerDisabled.search({ query: "test", requestId: "r15" });
    expect(res2.error?.category).toBe(SEARCH_ERROR_CATEGORIES.DISABLED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("连接测试：成功时返回真实 RequestId 与耗时，且产生真实请求", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ Response: { Query: "GEO Radar 连接测试", Pages: [JSON.stringify(samplePage)], RequestId: "req-conn-1", Version: "lite" } })
    );
    const provider = makeProvider(fetchMock as unknown as typeof fetch);
    const result = await provider.testConnection();
    expect(result.success).toBe(true);
    expect(result.madeRealRequest).toBe(true);
    expect(result.providerRequestId).toBe("req-conn-1");
    expect(result.providerVersion).toBe("lite");
    // 连接测试只发送 Query（最小请求）
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ Query: "GEO Radar 连接测试" });
  });

  it("参数构造：没有必要的参数不发送", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ Response: { Query: "q", Pages: [] } }));
    const provider = makeProvider(fetchMock as unknown as typeof fetch);
    await provider.search({ query: "q", requestId: "r16", maxResults: 20, mode: 2, industry: "news", freshness: "d7", deeplinks: true });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ Query: "q", Mode: 2, Cnt: 20, Industry: "news", Freshness: "d7", Deeplinks: true });
  });

  it("参数校验：非法 Cnt / Freshness / Site 会被本地拦截（不发请求）", async () => {
    const fetchMock = vi.fn();
    const provider = makeProvider(fetchMock as unknown as typeof fetch);
    const res1 = await provider.search({ query: "q", maxResults: 15 as never, requestId: "r17" });
    expect(res1.error?.category).toBe(SEARCH_ERROR_CATEGORIES.INVALID_PARAMETER);
    const res2 = await provider.search({ query: "q", freshness: "d45", requestId: "r18" });
    expect(res2.error?.category).toBe(SEARCH_ERROR_CATEGORIES.INVALID_PARAMETER);
    const res3 = await provider.search({ query: "q", site: "exclude:a.com|b.com|c.com|d.com|e.com|f.com", requestId: "r19" });
    expect(res3.error?.category).toBe(SEARCH_ERROR_CATEGORIES.INVALID_PARAMETER);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Msg 提示（如 hit black query）被记录且不影响结构", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ Response: { Query: "q", Pages: [], RequestId: "req-black", Msg: "hit black query" } })
    );
    const provider = makeProvider(fetchMock as unknown as typeof fetch);
    const res = await provider.search({ query: "q", requestId: "r20" });
    expect(res.status).toBe("success");
    expect(res.providerMsg).toBe("hit black query");
    expect(res.results).toHaveLength(0);
  });
});

describe("凭据加密", () => {
  it("AES-256-GCM 加解密往返", () => {
    const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
    process.env.CREDENTIAL_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    try {
      const secret = "my-yuanbao-api-key-987654321";
      const encrypted = encryptSecret(secret);
      expect(encrypted.startsWith("v1:")).toBe(true);
      expect(encrypted).not.toContain(secret);
      expect(decryptSecret(encrypted)).toBe(secret);
    } finally {
      if (previous === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
      else process.env.CREDENTIAL_ENCRYPTION_KEY = previous;
    }
  });

  it("缺少加密密钥时抛出明确错误（不允许明文降级）", () => {
    const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    try {
      expect(() => encryptSecret("abc")).toThrow(CredentialEncryptionError);
    } finally {
      if (previous !== undefined) process.env.CREDENTIAL_ENCRYPTION_KEY = previous;
    }
  });
});

describe("官方接口以 HTTP 200 返回业务错误（真实调用验证）", () => {
  it("UnauthorizedOperation 被正确分类且不可重试，保留 RequestId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse(
        {
          Response: {
            Error: { Code: "UnauthorizedOperation", Message: "未授权操作。" },
            RequestId: "0be4e6f6-e55b-47cb-b96a-3fc784f08500",
          },
        },
        200
      )
    );
    const provider = makeProvider(fetchMock as unknown as typeof fetch);
    const res = await provider.search({ query: "GEO 品牌可见性", requestId: "r-200" });
    expect(res.status).toBe("failed");
    expect(res.httpStatus).toBe(200);
    expect(res.error?.category).toBe(SEARCH_ERROR_CATEGORIES.UNAUTHORIZED_OPERATION);
    expect(res.error?.retryable).toBe(false);
    expect(res.providerRequestId).toBe("0be4e6f6-e55b-47cb-b96a-3fc784f08500");
    expect(res.error?.userMessage).toContain("认证或授权失败");
  });

  it("ResourceNotFound（未开通）同样在 200 包裹中正确分类", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ Response: { Error: { Code: "ResourceNotFound", Message: "用户资源未开通" }, RequestId: "rid-2" } }, 200)
    );
    const provider = makeProvider(fetchMock as unknown as typeof fetch);
    const res = await provider.search({ query: "q", requestId: "r-200b" });
    expect(res.error?.category).toBe(SEARCH_ERROR_CATEGORIES.RESOURCE_NOT_FOUND);
    expect(res.error?.userMessage).toContain("开通");
  });
});

describe("连接测试不应被「必须已连接」守卫挡住（真实使用发现）", () => {
  it("未通过测试的凭据仍可执行连接测试并发起真实请求", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ Response: { Query: "GEO Radar 连接测试", Pages: [], RequestId: "rid-conn", Version: "standard" } })
    );
    const provider = new YuanbaoSearchProvider({
      apiKey: "sk-test-key-1234567890",
      endpoint: TEST_ENDPOINT,
      credentialConnected: false,
      globallyEnabled: true,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const result = await provider.testConnection();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.madeRealRequest).toBe(true);
    expect(result.providerRequestId).toBe("rid-conn");

    // 但普通搜索仍然被守卫阻止
    const search = await provider.search({ query: "q", requestId: "r-guard" });
    expect(search.status).toBe("failed");
    expect(search.error?.category).toBe(SEARCH_ERROR_CATEGORIES.NOT_CONFIGURED);
  });
});
