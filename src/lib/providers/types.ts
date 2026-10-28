// 统一搜索供应商抽象。
// 该结构是 GEO Radar 内部数据模型，不代表元宝官方接口格式；
// 只有供应商真实返回的字段才会被填充，缺失字段保持 undefined，不伪造。

export type ProviderName = "YUANBAO" | "MOCK";

export interface SearchRequest {
  /** 搜索关键词（映射到元宝 Query） */
  query: string;
  /** 返回结果数量（元宝 Cnt：10/20/30/40/50，仅标准版及以上支持） */
  maxResults?: number;
  /** 结果类型（元宝 Mode：0 公开网页信源 / 1 优质权威垂直信源 / 2 混合，极速版不支持） */
  mode?: 0 | 1 | 2;
  /** 指定网站搜索或排除网站（元宝 Site） */
  site?: string;
  /** 垂直领域（元宝 Industry：gov/news/acad/finance，极速版不支持） */
  industry?: "gov" | "news" | "acad" | "finance";
  /** 搜索时效范围（元宝 Freshness） */
  freshness?: string;
  /** 是否返回子链信息（元宝 Deeplinks，仅旗舰版支持） */
  deeplinks?: boolean;
  /** GEO Radar 内部关联 ID */
  requestId: string;
  metadata?: Record<string, unknown>;
}

export interface SearchResultPic {
  caption?: string;
  originUrl?: string;
}

export interface SearchResultDeeplink {
  title?: string;
  url?: string;
}

export interface SearchResult {
  /** 在本次响应中的原始位置（0 起始） */
  position: number;
  title: string;
  url: string;
  domain?: string;
  /** 标准摘要（元宝 passage） */
  snippet?: string;
  /** 动态摘要（元宝 content，仅部分版本返回） */
  fullContent?: string;
  /** 网站名称（元宝 site，可能为空） */
  siteName?: string;
  /** 内容发布时间（元宝 date，原始字符串） */
  publishedAt?: string;
  /** 相关性得分 0~1（元宝 score，极速版不返回） */
  score?: number;
  /** 权威度 0~5（元宝 authority_level，仅旗舰版返回） */
  authorityLevel?: number;
  pics?: SearchResultPic[];
  favicon?: string;
  deeplinks?: SearchResultDeeplink[];
  /** 原始响应记录引用（RawSearchResponse.id） */
  rawEvidenceRef?: string;
}

export interface SearchErrorPayload {
  /** 错误分类，见 errors.ts */
  category: string;
  /** 供应商业务错误码（如 UnauthorizedOperation） */
  code?: string;
  message: string;
  /** 对用户展示的安全说明 */
  userMessage: string;
  /** 是否可安全重试（限流/超时/网络/供应商内部错误） */
  retryable: boolean;
  providerRequestId?: string;
  httpStatus?: number;
}

export interface SearchResponse {
  requestId: string;
  provider: string;
  status: "success" | "failed";
  query: string;
  results: SearchResult[];
  searchedAt: string;
  durationMs?: number;
  /** 供应商 RequestId */
  providerRequestId?: string;
  /** 供应商版本（lite/standard/flagship） */
  providerVersion?: string;
  /** 供应商 Msg 提示（如 hit black query） */
  providerMsg?: string;
  httpStatus?: number;
  /** 单条结果解析失败记录（不影响其他结果） */
  pageParseErrors?: Array<{ index: number; reason: string }>;
  /** 原始响应快照（由调用方持久化到 RawSearchResponse） */
  rawSnapshot?: string;
  rawSnapshotTruncated?: boolean;
  error?: SearchErrorPayload;
}

export interface ProviderStatus {
  provider: ProviderName;
  configured: boolean;
  /** 连接状态必须来自真实测试结果，不能因配置存在而直接为 true */
  connected: boolean;
  enabled: boolean;
  isMock: boolean;
  detail?: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ConnectionTestResult {
  success: boolean;
  provider: ProviderName;
  testedAt: string;
  durationMs?: number;
  providerRequestId?: string;
  providerVersion?: string;
  resultCount?: number;
  error?: SearchErrorPayload;
  /** 连接测试会产生真实计费请求（真实模式） */
  madeRealRequest: boolean;
}

export interface SearchProvider {
  readonly name: ProviderName;
  getStatus(): Promise<ProviderStatus>;
  validateConfig(config: { apiKey?: string }): Promise<ConfigValidationResult>;
  testConnection(): Promise<ConnectionTestResult>;
  search(request: SearchRequest): Promise<SearchResponse>;
  normalizeResponse(response: unknown): SearchResponse;
}
