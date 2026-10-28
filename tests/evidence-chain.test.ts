import { describe, it, expect } from "vitest";
import { normalizeUrl, pageKeyOf } from "@/lib/url-normalization";
import { classifyPage } from "@/lib/page-classification";
import { analyzeEvidencePage } from "@/server/services/brand-matching";
import { nextRunAfter, zonedWallTimeToUtc, isValidTimeZone } from "@/lib/schedule-time";
import { describeBasis } from "@/server/services/brand-matching";

describe("URL 规范化", () => {
  it("小写协议/主机、移除默认端口、去尾部斜杠与锚点、排序参数", () => {
    const result = normalizeUrl("HTTPS://Example.COM:443/a/?utm_source=x&b=2&a=1#section");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("https://example.com/a?a=1&b=2");
    expect(result.removedParams).toContain("utm_source");
  });

  it("只删除已知跟踪参数，保留可能决定内容的参数", () => {
    const result = normalizeUrl("https://example.com/product/item?id=123&utm_medium=cpc&spm=abc&lang=zh");
    expect(result.normalized).toBe("https://example.com/product/item?id=123&lang=zh");
    expect(result.keptParams).toEqual(["id", "lang"]);
    // source 不是已知跟踪参数，必须保留
    const keepSource = normalizeUrl("https://example.com/p?source=docs");
    expect(keepSource.normalized).toBe("https://example.com/p?source=docs");
  });

  it("不同产品页面不会被合并", () => {
    expect(pageKeyOf("https://example.com/products/a")).not.toBe(pageKeyOf("https://example.com/products/b"));
    expect(pageKeyOf("https://example.com/products/a/")).toBe(pageKeyOf("https://example.com/products/a"));
  });

  it("保留 SPA 路由型 fragment，移除普通锚点", () => {
    expect(normalizeUrl("https://example.com/#/route").normalized).toBe("https://example.com/#/route");
    expect(normalizeUrl("https://example.com/p#section").normalized).toBe("https://example.com/p");
  });

  it("百分号编码规范化：非保留字符解码、编码大写", () => {
    expect(normalizeUrl("https://example.com/%7Euser").normalized).toBe("https://example.com/~user");
    expect(normalizeUrl("https://example.com/p%2fq").normalized).toBe("https://example.com/p%2Fq");
    expect(normalizeUrl("https://example.com/search?q=中文").normalized).toContain("%E4%B8%AD%E6%96%87");
  });

  it("非法 URL 明确返回 invalid，不猜测", () => {
    expect(normalizeUrl("").valid).toBe(false);
    expect(normalizeUrl("not a url").valid).toBe(false);
    expect(normalizeUrl("javascript:alert(1)").valid).toBe(false);
    expect(normalizeUrl("ftp://example.com/a").valid).toBe(false);
  });

  it("页面键无效时回退到原始 URL（不合并不同页面）", () => {
    expect(pageKeyOf("https://example.com/a?x=1#one")).toBe("https://example.com/a?x=1");
    expect(pageKeyOf("")).toBe("");
  });
});

describe("页面类型识别", () => {
  const brand = { websiteDomain: "acme.com", officialSubdomains: ["docs.acme.com"] };

  it("官网首页/产品页/文档页", () => {
    expect(classifyPage({ url: "https://acme.com/", brand }).pageType).toBe("OFFICIAL_HOMEPAGE");
    expect(classifyPage({ url: "https://www.acme.com/products/item-a", brand }).pageType).toBe("PRODUCT_PAGE");
    expect(classifyPage({ url: "https://docs.acme.com/guide/start", brand }).pageType).toBe("DOCS_PAGE");
    expect(classifyPage({ url: "https://acme.com/blog/update", brand }).pageType).toBe("BLOG_NEWS");
    expect(classifyPage({ url: "https://acme.com/about", brand }).pageType).toBe("OTHER");
    expect(classifyPage({ url: "https://acme.com/about", brand }).sourceRole).toBe("OFFICIAL");
  });

  it("第三方媒体/社区/电商", () => {
    expect(classifyPage({ url: "https://36kr.com/p/123" }).pageType).toBe("THIRD_PARTY_MEDIA");
    expect(classifyPage({ url: "https://zhihu.com/question/123" }).pageType).toBe("COMMUNITY_FORUM");
    expect(classifyPage({ url: "https://item.jd.com/123.html" }).pageType).toBe("ECOMMERCE_PAGE");
    expect(classifyPage({ url: "https://news.example.com/2026/10/post", title: "Acme 产品深度评测" }).pageType).toBe(
      "THIRD_PARTY_MEDIA"
    );
  });

  it("无法可靠识别时返回 OTHER（有效 URL）或 UNKNOWN（无效 URL）", () => {
    const other = classifyPage({ url: "https://unknown-site.example/page" });
    expect(other.pageType).toBe("OTHER");
    expect(other.confidence).toBe("low");
    expect(classifyPage({ url: "not a url" }).pageType).toBe("UNKNOWN");
  });

  it("同域名不同路径不被当成同一种页面", () => {
    expect(classifyPage({ url: "https://acme.com/product/a", brand }).pageType).toBe("PRODUCT_PAGE");
    expect(classifyPage({ url: "https://acme.com/docs", brand }).pageType).toBe("DOCS_PAGE");
  });

  it("不能仅凭字符串包含判断官网", () => {
    expect(classifyPage({ url: "https://acme.com.evil.io/", brand }).pageType).toBe("OTHER");
    expect(classifyPage({ url: "https://acme.com.evil.io/", brand }).sourceRole).toBe("THIRD_PARTY");
  });

  it("显式登记的其他主域官方站点按精确域名/子域判定", () => {
    const brandWithGlobal = {
      websiteDomain: "acme.com",
      officialSubdomains: ["acme-global.cn"],
    };
    const official = classifyPage({ url: "https://www.acme-global.cn/about", brand: brandWithGlobal });
    expect(official.isOfficialDomain).toBe(true);
    expect(official.sourceRole).toBe("OFFICIAL");
    const fake = classifyPage({ url: "https://acme-global.cn.evil.io/about", brand: brandWithGlobal });
    expect(fake.isOfficialDomain).toBe(false);
  });
});

describe("品牌匹配与匹配依据", () => {
  const brand = {
    name: "Acme",
    aliases: ["Acme Cloud"],
    websiteDomain: "acme.com",
    officialSubdomains: [],
    products: ["Acme Search"],
    productAliases: ["AS"],
  };
  const competitors = [{ name: "Rival", aliases: ["Rival Inc"], websiteDomain: "rival.com" }];

  it("官网域名命中为强信号，并标记来源角色", () => {
    const result = analyzeEvidencePage(
      { url: "https://acme.com/product/search", title: "无关标题", snippet: "无关摘要" },
      brand,
      competitors
    );
    expect(result.mentionStatus).toBe("CONFIRMED_BRAND");
    expect(result.officialDomainMatch).toBe(true);
    expect(result.sourceRole).toBe("OFFICIAL");
    expect(result.brandMatchBasis).toContain("OFFICIAL_DOMAIN");
    expect(result.thirdPartyMention).toBe(false);
  });

  it("标题/摘要中的品牌名、别名、产品名分别记录依据", () => {
    const title = analyzeEvidencePage({ url: "https://news.example.com/a", title: "Acme 发布新品" }, brand, competitors);
    expect(title.mentionStatus).toBe("CONFIRMED_BRAND");
    expect(title.brandMatchBasis).toContain("TITLE_NAME");

    const alias = analyzeEvidencePage(
      { url: "https://news.example.com/a", title: "Acme Cloud 评测", snippet: "Acme Cloud 很好用" },
      brand,
      competitors
    );
    expect(alias.brandMatchBasis).toContain("TITLE_ALIAS");
    expect(alias.brandMatchBasis).toContain("SNIPPET_ALIAS");

    const product = analyzeEvidencePage({ url: "https://news.example.com/a", title: "Acme Search 上手" }, brand, competitors);
    expect(product.brandMatchBasis).toContain("TITLE_PRODUCT_NAME");
  });

  it("第三方提及与官网页面区分明确", () => {
    const result = analyzeEvidencePage(
      { url: "https://news.example.com/a", title: "Acme 深度报道" },
      brand,
      competitors
    );
    expect(result.sourceRole).toBe("THIRD_PARTY");
    expect(result.thirdPartyMention).toBe(true);
    expect(result.officialDomainMatch).toBe(false);
  });

  it("短别名低置信匹配进入待复核，但正式名称不被长度误降级", () => {
    const aliasResult = analyzeEvidencePage(
      { url: "https://news.example.com/a", title: "AS 是什么" },
      { name: "Acme", aliases: [], websiteDomain: "acme.com", officialSubdomains: [], products: [], productAliases: ["AS"] },
      []
    );
    expect(aliasResult.mentionStatus).toBe("PENDING_REVIEW");
    expect(aliasResult.brandMatchBasis).toContain("LOW_CONFIDENCE_ALIAS");

    const shortName = analyzeEvidencePage(
      { url: "https://news.example.com/a", title: "IBM 发布新模型" },
      { name: "IBM", aliases: [], websiteDomain: "ibm.com", officialSubdomains: [], products: [], productAliases: [] },
      []
    );
    expect(shortName.mentionStatus).toBe("CONFIRMED_BRAND");
    expect(shortName.brandMatchBasis).toContain("TITLE_NAME");
  });

  it("仅竞品命中时记录 COMPETITOR_ONLY，不误算品牌", () => {
    const result = analyzeEvidencePage(
      { url: "https://news.example.com/a", title: "Rival 发布新品" },
      brand,
      competitors
    );
    expect(result.mentionStatus).toBe("CONFIRMED_COMPETITOR");
    expect(result.competitorMatches).toEqual(["Rival"]);
    expect(result.brandMatchBasis).toContain("COMPETITOR_ONLY");
  });

  it("无命中与空文本区分", () => {
    const unrelated = analyzeEvidencePage(
      { url: "https://news.example.com/a", title: "完全无关的标题", snippet: "完全无关的摘要" },
      brand,
      competitors
    );
    expect(unrelated.mentionStatus).toBe("IRRELEVANT");
    expect(unrelated.brandMatchBasis).toContain("NONE");
    const empty = analyzeEvidencePage({ url: "https://news.example.com/a" }, brand, competitors);
    expect(empty.mentionStatus).toBe("PENDING_REVIEW");
  });

  it("匹配依据有中文说明", () => {
    expect(describeBasis("OFFICIAL_DOMAIN")).toContain("官网域名");
    expect(describeBasis("TITLE_NAME")).toContain("标题");
  });
});

describe("定时采集时间计算", () => {
  it("时区有效性与错误时区", () => {
    expect(isValidTimeZone("Asia/Shanghai")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(() =>
      nextRunAfter(new Date(), { frequency: "DAILY", hour: 9, minute: 0, timezone: "Not/AZone" })
    ).toThrow(/时区/);
  });

  it("上海时区每天 09:00 换算为 UTC 01:00", () => {
    const utc = zonedWallTimeToUtc(2026, 10, 29, 9, 0, "Asia/Shanghai");
    expect(utc?.toISOString()).toBe("2026-10-29T01:00:00.000Z");
  });

  it("当天时间未到取当天，已过取次日", () => {
    const before = nextRunAfter(new Date("2026-10-28T00:00:00.000Z"), {
      frequency: "DAILY",
      hour: 9,
      minute: 0,
      timezone: "Asia/Shanghai",
    });
    expect(before.toISOString()).toBe("2026-10-28T01:00:00.000Z");
    const after = nextRunAfter(new Date("2026-10-28T02:00:00.000Z"), {
      frequency: "DAILY",
      hour: 9,
      minute: 0,
      timezone: "Asia/Shanghai",
    });
    expect(after.toISOString()).toBe("2026-10-29T01:00:00.000Z");
  });

  it("每周采集取下一个匹配星期", () => {
    // 2026-10-28 是周三；请求周一 09:00（上海）
    const next = nextRunAfter(new Date("2026-10-28T02:00:00.000Z"), {
      frequency: "WEEKLY",
      hour: 9,
      minute: 0,
      weekday: 1,
      timezone: "Asia/Shanghai",
    });
    expect(next.toISOString()).toBe("2026-11-02T01:00:00.000Z");
  });
});
