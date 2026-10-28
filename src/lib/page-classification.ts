import { isConfiguredOfficialHost, sameSite } from "@/lib/domain-utils";
import { normalizeUrl } from "@/lib/url-normalization";

/**
 * 页面类型识别（可解释规则）。
 *
 * 顺序：官网判定 → 官网路径细分 → 第三方已知站点 → 第三方路径/标题线索 → OTHER / UNKNOWN。
 * 无法可靠识别时返回 UNKNOWN，不为了提高覆盖率强行归类。
 * 所有规则都有 ruleId + reason，可在证据详情中展示与人工修正。
 */

export type PageTypeValue =
  | "OFFICIAL_HOMEPAGE"
  | "PRODUCT_PAGE"
  | "DOCS_PAGE"
  | "BLOG_NEWS"
  | "THIRD_PARTY_MEDIA"
  | "ECOMMERCE_PAGE"
  | "COMMUNITY_FORUM"
  | "OTHER"
  | "UNKNOWN";

export type SourceRoleValue = "OFFICIAL" | "THIRD_PARTY" | "UNKNOWN";

export interface BrandSiteConfig {
  websiteDomain?: string | null;
  officialSubdomains?: string[] | null;
}

export interface PageClassificationInput {
  url: string;
  domain?: string | null;
  title?: string | null;
  snippet?: string | null;
  siteName?: string | null;
  brand?: BrandSiteConfig | null;
}

export interface PageClassification {
  pageType: PageTypeValue;
  sourceRole: SourceRoleValue;
  ruleId: string;
  reason: string;
  /** 规范化 URL 主机名（无效 URL 时为 null） */
  hostname: string | null;
  isOfficialDomain: boolean;
  /** 规则置信度：HIGH 有明确站点/路径证据；LOW 仅兜底分类 */
  confidence: "high" | "low";
}

const DOCS_HOST_PREFIXES = ["docs.", "doc.", "developer.", "developers.", "help.", "support.", "wiki.", "api.", "manual.", "learn."];
const DOCS_PATH_RE = /\/(docs?|documentation|help|help-center|support|guide|guides|manual|manuals|faq|wiki|tutorial|tutorials|reference|api-docs)(\/|$)/i;
const BLOG_PATH_RE = /\/(blog|insights|changelog|updates?|post|posts)(\/|$)/i;
const MEDIA_PATH_RE = /\/(news|article|articles|story|stories|press|press-release)(\/|$)/i;
const PRODUCT_PATH_RE = /\/(product|products|pricing|plans|features|solutions|services|service|item|items|goods|buy|shop|store)(\/|$)/i;
const HOMEPAGE_PATHS = new Set(["/", "/index.html", "/index.htm", "/home", "/index.php"]);
const COMMUNITY_PATH_RE = /\/(forum|forums|community|communities|thread|threads|topic|topics|question|questions|discussion|discussions|group|groups)(\/|$)/i;
const ECOMMERCE_PATH_RE = /\/(product|products|item|items|goods|dp|sku|buy|cart|shop|store)(\/|$)/i;

const ECOMMERCE_DOMAINS = [
  "taobao.com",
  "tmall.com",
  "jd.com",
  "pinduoduo.com",
  "1688.com",
  "suning.com",
  "vip.com",
  "youzan.com",
  "amazon.com",
  "amazon.cn",
  "amazon.co.uk",
  "ebay.com",
  "etsy.com",
  "shopee.com",
  "shopee.cn",
  "temu.com",
  "aliexpress.com",
  "walmart.com",
];

const COMMUNITY_DOMAINS = [
  "zhihu.com",
  "reddit.com",
  "v2ex.com",
  "tieba.baidu.com",
  "douban.com",
  "xiaohongshu.com",
  "weibo.com",
  "x.com",
  "twitter.com",
  "facebook.com",
  "linkedin.com",
  "stackoverflow.com",
  "quora.com",
  "bilibili.com",
  "youtube.com",
  "tiktok.com",
  "hackernews.com",
  "news.ycombinator.com",
  "discord.com",
  "slack.com",
];

const MEDIA_DOMAINS = [
  "36kr.com",
  "ithome.com",
  "sina.com.cn",
  "sina.cn",
  "sohu.com",
  "163.com",
  "qq.com",
  "thepaper.cn",
  "ifeng.com",
  "caixin.com",
  "yicai.com",
  "huxiu.com",
  "jiqizhixin.com",
  "geekpark.net",
  "leiphone.com",
  "medium.com",
  "techcrunch.com",
  "theverge.com",
  "wired.com",
  "reuters.com",
  "bloomberg.com",
  "forbes.com",
  "nytimes.com",
  "cnbc.com",
  "bbc.com",
  "cnn.com",
];

const DOCS_DOMAINS = ["readthedocs.io", "readthedocs.org", "gitbook.io", "gitbook.com", "notion.site", "confluence.com"];

function hostMatchesDomain(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  const target = domain.toLowerCase();
  return host === target || host.endsWith(`.${target}`);
}

function matchesAnyDomain(hostname: string, domains: string[]): boolean {
  return domains.some((domain) => hostMatchesDomain(hostname, domain));
}

function titleHas(title: string, words: string[]): string | null {
  const lower = title.toLowerCase();
  return words.find((word) => lower.includes(word.toLowerCase())) ?? null;
}

function classifyOfficialPath(path: string): { pageType: PageTypeValue; ruleId: string; reason: string } {
  if (HOMEPAGE_PATHS.has(path.toLowerCase())) {
    return { pageType: "OFFICIAL_HOMEPAGE", ruleId: "official:homepage-path", reason: `官网域名 + 根路径 ${path}` };
  }
  if (DOCS_PATH_RE.test(path)) {
    return { pageType: "DOCS_PAGE", ruleId: "official:docs-path", reason: `官网域名 + 文档/帮助路径 ${path}` };
  }
  if (BLOG_PATH_RE.test(path) || MEDIA_PATH_RE.test(path)) {
    return { pageType: "BLOG_NEWS", ruleId: "official:blog-path", reason: `官网域名 + 博客/资讯路径 ${path}` };
  }
  if (PRODUCT_PATH_RE.test(path)) {
    return { pageType: "PRODUCT_PAGE", ruleId: "official:product-path", reason: `官网域名 + 产品/方案路径 ${path}` };
  }
  return {
    pageType: "OTHER",
    ruleId: "official:other-path",
    reason: `官网域名，但路径 ${path} 未命中首页/产品/文档/博客规则`,
  };
}

export function classifyPage(input: PageClassificationInput): PageClassification {
  const normalized = normalizeUrl(input.url);
  const rawHost = input.domain ?? normalized.hostname;
  const hostname = rawHost ? rawHost.toLowerCase().replace(/\.$/, "") : null;

  if (!normalized.valid || !hostname) {
    return {
      pageType: "UNKNOWN",
      sourceRole: "UNKNOWN",
      ruleId: "invalid-url",
      reason: normalized.reason ?? "URL 无法解析，无法判断页面类型",
      hostname: null,
      isOfficialDomain: false,
      confidence: "low",
    };
  }

  const officialDomain =
    isConfiguredOfficialHost(hostname, input.brand?.websiteDomain ?? null, input.brand?.officialSubdomains ?? []) ||
    (input.domain ? sameSite(input.domain, input.brand?.websiteDomain ?? null) : false);

  const path = normalized.path ?? "/";
  const title = (input.title ?? "").trim();
  const siteName = (input.siteName ?? "").trim();

  if (officialDomain) {
    const result = classifyOfficialPath(path);
    return {
      ...result,
      sourceRole: "OFFICIAL",
      hostname,
      isOfficialDomain: true,
      confidence: "high",
    };
  }

  // 第三方已知站点优先
  if (matchesAnyDomain(hostname, DOCS_DOMAINS)) {
    return {
      pageType: "DOCS_PAGE",
      sourceRole: "THIRD_PARTY",
      ruleId: "third-party:docs-domain",
      reason: `第三方文档平台 ${hostname}`,
      hostname,
      isOfficialDomain: false,
      confidence: "high",
    };
  }
  if (matchesAnyDomain(hostname, ECOMMERCE_DOMAINS)) {
    return {
      pageType: "ECOMMERCE_PAGE",
      sourceRole: "THIRD_PARTY",
      ruleId: "third-party:ecommerce-domain",
      reason: `电商平台域名 ${hostname}`,
      hostname,
      isOfficialDomain: false,
      confidence: "high",
    };
  }
  if (matchesAnyDomain(hostname, COMMUNITY_DOMAINS)) {
    return {
      pageType: "COMMUNITY_FORUM",
      sourceRole: "THIRD_PARTY",
      ruleId: "third-party:community-domain",
      reason: `社区/论坛平台域名 ${hostname}`,
      hostname,
      isOfficialDomain: false,
      confidence: "high",
    };
  }
  if (matchesAnyDomain(hostname, MEDIA_DOMAINS)) {
    return {
      pageType: "THIRD_PARTY_MEDIA",
      sourceRole: "THIRD_PARTY",
      ruleId: "third-party:media-domain",
      reason: `第三方媒体域名 ${hostname}`,
      hostname,
      isOfficialDomain: false,
      confidence: "high",
    };
  }

  // 路径线索
  if (DOCS_PATH_RE.test(path) || DOCS_HOST_PREFIXES.some((prefix) => hostname.startsWith(prefix))) {
    return {
      pageType: "DOCS_PAGE",
      sourceRole: "THIRD_PARTY",
      ruleId: "third-party:docs-path",
      reason: `第三方页面 + 文档/帮助路径 ${path}`,
      hostname,
      isOfficialDomain: false,
      confidence: "high",
    };
  }
  if (ECOMMERCE_PATH_RE.test(path)) {
    return {
      pageType: "ECOMMERCE_PAGE",
      sourceRole: "THIRD_PARTY",
      ruleId: "third-party:ecommerce-path",
      reason: `第三方页面 + 商品/购买路径 ${path}`,
      hostname,
      isOfficialDomain: false,
      confidence: "high",
    };
  }
  if (COMMUNITY_PATH_RE.test(path)) {
    return {
      pageType: "COMMUNITY_FORUM",
      sourceRole: "THIRD_PARTY",
      ruleId: "third-party:community-path",
      reason: `第三方页面 + 社区/问答路径 ${path}`,
      hostname,
      isOfficialDomain: false,
      confidence: "high",
    };
  }
  if (MEDIA_PATH_RE.test(path)) {
    return {
      pageType: "THIRD_PARTY_MEDIA",
      sourceRole: "THIRD_PARTY",
      ruleId: "third-party:media-path",
      reason: `第三方页面 + 新闻/文章路径 ${path}`,
      hostname,
      isOfficialDomain: false,
      confidence: "high",
    };
  }

  // 标题线索（仅在路径无明确线索时使用，置信度较低）
  const docsWord = titleHas(title, ["帮助中心", "使用指南", "官方文档", "文档中心", "FAQ"]);
  if (docsWord) {
    return {
      pageType: "DOCS_PAGE",
      sourceRole: "THIRD_PARTY",
      ruleId: "third-party:docs-title",
      reason: `标题包含「${docsWord}」，归为文档/帮助页（标题线索）`,
      hostname,
      isOfficialDomain: false,
      confidence: "low",
    };
  }
  const mediaWord = titleHas(title, ["评测", "测评", "资讯", "新闻", "报道", "发布会"]);
  if (mediaWord) {
    return {
      pageType: "THIRD_PARTY_MEDIA",
      sourceRole: "THIRD_PARTY",
      ruleId: "third-party:media-title",
      reason: `标题包含「${mediaWord}」，归为第三方媒体页（标题线索）`,
      hostname,
      isOfficialDomain: false,
      confidence: "low",
    };
  }
  const communityWord = titleHas(title, ["论坛", "社区", "问答", "讨论"]);
  if (communityWord) {
    return {
      pageType: "COMMUNITY_FORUM",
      sourceRole: "THIRD_PARTY",
      ruleId: "third-party:community-title",
      reason: `标题包含「${communityWord}」，归为社区/论坛页（标题线索）`,
      hostname,
      isOfficialDomain: false,
      confidence: "low",
    };
  }
  if (BLOG_PATH_RE.test(path)) {
    return {
      pageType: "BLOG_NEWS",
      sourceRole: "THIRD_PARTY",
      ruleId: "third-party:blog-path",
      reason: `第三方页面 + 博客路径 ${path}`,
      hostname,
      isOfficialDomain: false,
      confidence: "high",
    };
  }

  // 有效但无法可靠识别：标为其他页面（不声称具体类型），人工可修正
  return {
    pageType: "OTHER",
    sourceRole: "THIRD_PARTY",
    ruleId: "third-party:other",
    reason: `非官网页面，路径 ${path} 与标题/站点名均未命中具体分类规则${siteName ? `（站点：${siteName}）` : ""}`,
    hostname,
    isOfficialDomain: false,
    confidence: "low",
  };
}
