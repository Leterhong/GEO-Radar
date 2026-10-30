import { describe, it, expect } from "vitest";
import { parsePageEntry, extractProviderEnvelope, normalizeProviderPayload, mapYuanbaoPage } from "@/lib/providers/yuanbao/yuanbao-search.mapper";
import {
  validateFreshnessInput,
  validateSiteInput,
  buildYuanbaoRequestBody,
  yuanbaoSearchParamsSchema,
} from "@/lib/providers/yuanbao/yuanbao-search.schema";
import { toRegistrableDomain, sameSite, extractWebsiteDomain } from "@/server/services/domain-normalization";
import { matchEntityInText, detectMention } from "@/server/services/mention-detection";
import { parseCsv, serializeCsv, sanitizeCsvInput } from "@/lib/csv";
import { buildMockPages } from "@/lib/providers/mock/mock-data";
import { evaluateRealModeGuard } from "@/server/services/search-execution";

describe("元宝参数校验", () => {
  it("Freshness 五种形态合法值", () => {
    expect(validateFreshnessInput("d7").ok).toBe(true);
    expect(validateFreshnessInput("d30").ok).toBe(true);
    expect(validateFreshnessInput("m12").ok).toBe(true);
    expect(validateFreshnessInput("y5").ok).toBe(true);
    expect(validateFreshnessInput("2026-01-01").ok).toBe(true);
    expect(validateFreshnessInput("2026-01-01,2025-12-01").ok).toBe(true);
  });

  it("Freshness 非法值被拒绝", () => {
    expect(validateFreshnessInput("d31").ok).toBe(false);
    expect(validateFreshnessInput("m13").ok).toBe(false);
    expect(validateFreshnessInput("y6").ok).toBe(false);
    expect(validateFreshnessInput("2024-02-31").ok).toBe(false);
    expect(validateFreshnessInput("2030-01-01").ok).toBe(false); // 晚于当天
    expect(validateFreshnessInput("2026-01-01,2026-02-01").ok).toBe(false); // B 晚于 A
    expect(validateFreshnessInput("d7m3").ok).toBe(false); // 混合
  });

  it("Site 支持单域名与最多 5 个排除域名", () => {
    expect(validateSiteInput("zhihu.com").ok).toBe(true);
    expect(validateSiteInput("exclude:a.com|b.com").ok).toBe(true);
    expect(validateSiteInput("exclude:a.com|b.com|c.com|d.com|e.com|f.com").ok).toBe(false);
    expect(validateSiteInput("not a domain").ok).toBe(false);
  });

  it("Cnt 枚举校验", () => {
    expect(yuanbaoSearchParamsSchema.safeParse({ query: "q", maxResults: 10 }).success).toBe(true);
    expect(yuanbaoSearchParamsSchema.safeParse({ query: "q", maxResults: 15 }).success).toBe(false);
  });

  it("Query 必填且限制长度", () => {
    expect(yuanbaoSearchParamsSchema.safeParse({ query: "" }).success).toBe(false);
    expect(yuanbaoSearchParamsSchema.safeParse({ query: "x".repeat(201) }).success).toBe(false);
  });

  it("Query 保留特殊字符并 trim", () => {
    const parsed = yuanbaoSearchParamsSchema.parse({ query: "  AI 搜索 & 品牌/Q3  " });
    expect(parsed.query).toBe("AI 搜索 & 品牌/Q3");
    expect(buildYuanbaoRequestBody({ query: "A&B/C + 中文" })).toEqual({ body: { Query: "A&B/C + 中文" } });
  });

  it("请求体：只有提供的参数才会发送", () => {
    const built = buildYuanbaoRequestBody({ query: "q" });
    expect(built).toEqual({ body: { Query: "q" } });
    const full = buildYuanbaoRequestBody({
      query: "q",
      mode: 2,
      maxResults: 50,
      industry: "finance",
      site: "qq.com",
      freshness: "m3",
      deeplinks: true,
    });
    expect(full).toEqual({
      body: { Query: "q", Mode: 2, Cnt: 50, Industry: "finance", Site: "qq.com", Freshness: "m3", Deeplinks: true },
    });
  });
});

describe("响应解析", () => {
  it("extractProviderEnvelope 解析官方包裹结构", () => {
    const envelope = extractProviderEnvelope({
      Response: { Query: "q", Pages: ["{}"], RequestId: "rid", Version: "standard", Msg: "" },
    });
    expect(envelope.query).toBe("q");
    expect(envelope.pages).toHaveLength(1);
    expect(envelope.requestId).toBe("rid");
  });

  it("extractProviderEnvelope 捕获业务错误", () => {
    expect(() =>
      extractProviderEnvelope({ Response: { Error: { Code: "UnauthorizedOperation", Message: "x" } } })
    ).toThrowError(/PROVIDER_BUSINESS_ERROR/);
  });

  it("缺失 Pages 抛出 missingField", () => {
    expect(() => extractProviderEnvelope({ Response: { Query: "q" } })).toThrowError(/Pages/);
  });

  it("parsePageEntry 兼容对象与 JSON 字符串", () => {
    expect(parsePageEntry(JSON.stringify({ url: "https://a.com" }), 0).ok).toBe(true);
    expect(parsePageEntry({ url: "https://a.com" }, 0).ok).toBe(true);
    expect(parsePageEntry("not json", 0).ok).toBe(false);
    expect(parsePageEntry(42, 0).ok).toBe(false);
  });

  it("normalizeProviderPayload：整体失败与部分失败区分", () => {
    const okPayload = { Response: { Query: "q", Pages: [JSON.stringify({ url: "https://a.com/1", title: "t" })], RequestId: "r" } };
    const normalized = normalizeProviderPayload(okPayload, {
      requestId: "x",
      provider: "YUANBAO",
      query: "q",
      searchedAt: new Date().toISOString(),
    });
    expect(normalized.status).toBe("success");
    expect(normalized.results[0]?.rawEvidenceRef).toBeUndefined();
    expect(normalized.pageParseErrors).toBeUndefined();

    const badPayload = { Response: { Query: "q", Pages: 42 } };
    const failed = normalizeProviderPayload(badPayload, {
      requestId: "x",
      provider: "YUANBAO",
      query: "q",
      searchedAt: new Date().toISOString(),
    });
    expect(failed.status).toBe("failed");
    expect(failed.error?.category).toBe("MISSING_RESPONSE_FIELD");
  });

  it("mapYuanbaoPage 保留真实返回字段", () => {
    const mapped = mapYuanbaoPage({
      url: "https://news.example.cn/a",
      title: "标题",
      date: "2026-02-01",
      passage: "摘要",
      site: "示例新闻",
      authority_level: 4,
      deeplinks: [{ title: "子链", url: "https://news.example.cn/sub" }],
    }, 3);
    expect(mapped.position).toBe(3);
    expect(mapped.domain).toBe("news.example.cn");
    expect(mapped.authorityLevel).toBe(4);
    expect(mapped.deeplinks?.[0]?.url).toBe("https://news.example.cn/sub");
  });
});

describe("域名规范化", () => {
  it("可注册主域提取", () => {
    expect(toRegistrableDomain("www.example.com")).toBe("example.com");
    expect(toRegistrableDomain("a.b.example.com.cn")).toBe("example.com.cn");
    expect(toRegistrableDomain("https://news.qq.com/a/1.html")).toBe("qq.com");
    expect(toRegistrableDomain("not a domain")).toBeNull();
  });

  it("同站判定：子域名属于官网，但不同主域不算", () => {
    expect(sameSite("www.example.com", "example.com")).toBe(true);
    expect(sameSite("docs.example.com", "example.com")).toBe(true);
    expect(sameSite("example.com.evil.io", "example.com")).toBe(false);
    expect(sameSite("notexample.com", "example.com")).toBe(false);
  });

  it("官网域名提取", () => {
    expect(extractWebsiteDomain("https://www.Example.COM/path")).toBe("www.example.com");
    expect(extractWebsiteDomain("example.com")).toBe("example.com");
    expect(extractWebsiteDomain("ftp://example.com")).toBeNull();
    expect(extractWebsiteDomain("")).toBeNull();
  });
});

describe("品牌提及识别", () => {
  it("品牌名精确词边界匹配（拉丁）", () => {
    const brand = { name: "Acme", aliases: ["Acme Corp"], websiteDomain: null };
    expect(matchEntityInText(brand, { title: "Acme launches new tool" }).matched).toBe(true);
    // 不应把 "Acmeless" 误判为 Acme
    expect(matchEntityInText(brand, { title: "Acmeless company" }).matched).toBe(false);
  });

  it("中文品牌名包含匹配", () => {
    const brand = { name: "云梯科技", aliases: [], websiteDomain: null };
    expect(matchEntityInText(brand, { title: "云梯科技发布新品" }).matched).toBe(true);
    expect(matchEntityInText(brand, { title: "完全无关的标题" }).matched).toBe(false);
  });

  it("官网域名命中为强信号", () => {
    const brand = { name: "Acme", aliases: [], websiteDomain: "example.com" };
    const m = matchEntityInText(brand, { title: "无关标题", url: "https://blog.example.com/post" });
    expect(m.matched).toBe(true);
    expect(m.matchedTerms[0]).toContain("domain:");
    expect(m.confidence).toBe("high");
  });

  it("detectMention 输出可追溯状态", () => {
    const brand = { name: "Acme", aliases: [], websiteDomain: null };
    const competitors = [{ name: "Rival", aliases: [], websiteDomain: null }];
    expect(detectMention(brand, competitors, { title: "Acme 发布新品" }).mentionStatus).toBe("CONFIRMED_BRAND");
    const competitorOnly = detectMention(brand, competitors, { title: "Rival 发布新品" });
    expect(competitorOnly.mentionStatus).toBe("CONFIRMED_COMPETITOR");
    expect(competitorOnly.competitorMatches).toEqual(["Rival"]);
    expect(detectMention(brand, competitors, { title: "无关内容" }).mentionStatus).toBe("IRRELEVANT");
    // 文本为空 → 待复核
    expect(detectMention(brand, competitors, { title: "" }).mentionStatus).toBe("PENDING_REVIEW");
    // 低置信（过短拉丁别名）→ 待复核
    const shortAlias = detectMention({ name: "Xy", aliases: ["AB"], websiteDomain: null }, [], { title: "AB is a brand" });
    expect(shortAlias.mentionStatus).toBe("PENDING_REVIEW");
  });
});

describe("CSV 工具", () => {
  it("解析带引号与换行的 CSV", () => {
    const csv = 'text,category\n"含,逗号的问题","cat1"\n"含""引号""的问题",cat2\n"跨\n行问题",cat3';
    const result = parseCsv(csv);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(4);
    expect(result.rows[1]?.[0]).toBe("含,逗号的问题");
    expect(result.rows[2]?.[0]).toBe('含"引号"的问题');
    expect(result.rows[3]?.[0]).toBe("跨\n行问题");
  });

  it("未闭合引号报错", () => {
    const result = parseCsv('text\n"unclosed');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("序列化往返", () => {
    const csv = serializeCsv(["a", "b"], [['x,"y"', "z"]]);
    const back = parseCsv(csv);
    expect(back.rows[1]?.[0]).toBe('x,"y"');
  });

  it("阻断 CSV 公式注入", () => {
    const csv = serializeCsv(["value"], [['=HYPERLINK("https://evil")'], ["+1"], ["@cmd"]]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+1");
    expect(csv).toContain("'@cmd");
  });

  it("BOM 清理与大小限制", () => {
    expect(sanitizeCsvInput("\uFEFFtext")).toBe("text");
    expect(() => sanitizeCsvInput("x".repeat(600 * 1024))).toThrow(/过大/);
  });
});

describe("Mock 与真实隔离", () => {
  it("Mock 结果确定且带模拟摘要", () => {
    const pages = buildMockPages("测试问题", 3);
    expect(pages).toHaveLength(3);
    expect(pages.every((p) => p.passage.includes("模拟"))).toBe(true);
    expect(pages.every((p) => p.url.includes("/mock/"))).toBe(true);
    // 相同 query 生成相同结果（确定性）
    expect(buildMockPages("测试问题", 3)).toEqual(pages);
  });
});

describe("真实模式守卫", () => {
  it("未配置/禁用/未连接/未启用 都会阻止", () => {
    const prevEnabled = process.env.YUANBAO_SEARCH_ENABLED;
    const prevKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    process.env.CREDENTIAL_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    try {
      expect(evaluateRealModeGuard(null).ok).toBe(false);
      expect(evaluateRealModeGuard({ encryptedSecret: "v1:x", status: "DISABLED" }).ok).toBe(false);
      expect(evaluateRealModeGuard({ encryptedSecret: "v1:x", status: "PENDING_VERIFICATION" }).ok).toBe(false);
      expect(evaluateRealModeGuard({ encryptedSecret: "v1:x", status: "FAILED" }).ok).toBe(false);
      // CONNECTED 但全局开关关闭
      process.env.YUANBAO_SEARCH_ENABLED = "false";
      expect(evaluateRealModeGuard({ encryptedSecret: "v1:x", status: "CONNECTED" }).ok).toBe(false);
      process.env.YUANBAO_SEARCH_ENABLED = "true";
      expect(evaluateRealModeGuard({ encryptedSecret: "v1:x", status: "CONNECTED" }).ok).toBe(true);
    } finally {
      if (prevEnabled === undefined) delete process.env.YUANBAO_SEARCH_ENABLED;
      else process.env.YUANBAO_SEARCH_ENABLED = prevEnabled;
      if (prevKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
      else process.env.CREDENTIAL_ENCRYPTION_KEY = prevKey;
    }
  });
});
