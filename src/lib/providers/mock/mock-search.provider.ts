import type {
  ConfigValidationResult,
  ConnectionTestResult,
  ProviderStatus,
  SearchProvider,
  SearchRequest,
  SearchResponse,
} from "@/lib/providers/types";
import { buildMockPages } from "./mock-data";
import { mapYuanbaoPage, extractDomain } from "@/lib/providers/yuanbao/yuanbao-search.mapper";

/**
 * Mock 搜索供应商：仅用于开发、测试与功能演示。
 * 不发起任何外部请求；所有结果标记 isMock=true，绝不进入真实统计。
 * Mock 的连接测试永远不能把真实数据源标记为“已连接”。
 */
export class MockSearchProvider implements SearchProvider {
  readonly name = "MOCK" as const;

  async getStatus(): Promise<ProviderStatus> {
    return {
      provider: this.name,
      configured: true,
      connected: true,
      enabled: true,
      isMock: true,
      detail: "模拟模式：仅用于开发与演示，数据带模拟标记",
    };
  }

  async validateConfig(): Promise<ConfigValidationResult> {
    return { valid: true, errors: [] };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    // Mock 测试不发起真实请求，也不代表真实数据源连通
    return {
      success: true,
      provider: this.name,
      testedAt: new Date().toISOString(),
      durationMs: 0,
      resultCount: 3,
      madeRealRequest: false,
    };
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    const startedAt = Date.now();
    const pages = buildMockPages(request.query, request.maxResults ?? 5);
    const results = pages.map((page, index) => {
      const mapped = mapYuanbaoPage(page, index);
      return { ...mapped, domain: extractDomain(mapped.url) ?? mapped.domain };
    });
    return {
      requestId: request.requestId,
      provider: this.name,
      status: "success",
      query: request.query,
      results,
      searchedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      providerRequestId: `mock-${request.requestId}`,
      providerVersion: "mock",
      providerMsg: "MOCK 模拟结果，仅用于功能演示",
    };
  }

  normalizeResponse(response: unknown): SearchResponse {
    void response;
    return {
      requestId: "mock-normalize",
      provider: this.name,
      status: "success",
      query: "",
      results: [],
      searchedAt: new Date().toISOString(),
    };
  }
}
