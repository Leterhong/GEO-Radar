import { describe, it, expect } from "vitest";
import {
  normalizeForMatch,
  countTermOccurrences,
  mentionsEntity,
  isBrandAttributableSource,
  computeAnswerMetrics,
  computeLabQuestionSetBreakdown,
  type CorpusItem,
  type BrandTerms,
} from "@/server/services/analysis/metrics-engine";

const brand: BrandTerms = { name: "元宝", aliases: ["Yuanbao"], websiteDomain: "yuanbao.tencent.com" };

function item(partial: Partial<CorpusItem>): CorpusItem {
  return {
    runId: "r1",
    question: "示例问题",
    answer: "示例回答",
    answeredAt: "2026-10-01T10:00:00.000Z",
    sources: [{ url: "https://news.example.com/a", domain: "news.example.com", mentionStatus: "IRRELEVANT" }],
    ...partial,
  };
}

describe("文本规范化与计数", () => {
  it("全角转半角、大小写、空白压缩", () => {
    expect(normalizeForMatch("ＡＢＣ　　Test")).toBe("abc test");
  });

  it("拉丁词按词边界计数", () => {
    expect(countTermOccurrences("Acme and ACME, but not Acmeless", "acme")).toBe(2);
    expect(countTermOccurrences("Acmeless", "acme")).toBe(0);
  });

  it("中文按包含计数（可重复）", () => {
    expect(countTermOccurrences("元宝发布新产品，元宝表示", "元宝")).toBe(2);
  });

  it("mentionsEntity 支持别名", () => {
    expect(mentionsEntity("Yuanbao released an update", brand)).toBe(true);
    expect(mentionsEntity("完全无关的内容", brand)).toBe(false);
  });
});

describe("来源归因", () => {
  it("官网同站域名可归因（含子域）", () => {
    expect(isBrandAttributableSource({ url: "https://yuanbao.tencent.com/x", domain: "yuanbao.tencent.com", mentionStatus: "IRRELEVANT" }, brand)).toBe(true);
    expect(isBrandAttributableSource({ url: "https://blog.yuanbao.tencent.com/x", domain: "blog.yuanbao.tencent.com", mentionStatus: "IRRELEVANT" }, brand)).toBe(true);
  });

  it("确认为本品牌的证据可归因，即便域名不同", () => {
    expect(isBrandAttributableSource({ url: "https://36kr.com/p/1", domain: "36kr.com", mentionStatus: "CONFIRMED_BRAND" }, brand)).toBe(true);
  });

  it("同主域的冒牌域名不可归因", () => {
    expect(isBrandAttributableSource({ url: "https://yuanbao.tencent.com.evil.io/x", domain: "yuanbao.tencent.com.evil.io", mentionStatus: "IRRELEVANT" }, brand)).toBe(false);
  });

  it("无关来源不可归因", () => {
    expect(isBrandAttributableSource({ url: "https://zhihu.com/q/1", domain: "zhihu.com", mentionStatus: "IRRELEVANT" }, brand)).toBe(false);
  });
});

describe("answer 级指标", () => {
  it("无样本时指标不可计算且标注 insufficient", () => {
    const result = computeAnswerMetrics({ corpus: [], brand, competitors: [] });
    expect(result.answerCount).toBe(0);
    const mention = result.metrics.find((m) => m.key === "brand_mention_rate");
    expect(mention?.value).toBeNull();
    expect(mention?.insufficient).toBe(true);
    expect(mention?.notes).toContain("暂无有效回答样本");
  });

  it("无来源的回答不进入分母", () => {
    const result = computeAnswerMetrics({
      corpus: [
        item({ runId: "a", answer: "提到了元宝", sources: [] }),
        item({ runId: "b", answer: "提到了元宝" }),
      ],
      brand,
      competitors: [],
    });
    expect(result.answerCount).toBe(1);
    expect(result.answersWithoutSources).toBe(1);
    expect(result.metrics.find((m) => m.key === "brand_mention_rate")?.value).toBe(1);
  });

  it("提及率与引用率口径不同（正文提及 ≠ 引用）", () => {
    const result = computeAnswerMetrics({
      corpus: [
        // 正文提及品牌，但来源都不是品牌的
        item({ runId: "a", answer: "根据来源，元宝表现不错 [1]", sources: [{ url: "https://zhihu.com/1", domain: "zhihu.com", mentionStatus: "IRRELEVANT" }] }),
        // 正文未提及，但引用了官网来源
        item({ runId: "b", answer: "该产品提供搜索能力 [1]", sources: [{ url: "https://yuanbao.tencent.com/docs", domain: "yuanbao.tencent.com", mentionStatus: "IRRELEVANT" }] }),
      ],
      brand,
      competitors: [],
    });
    expect(result.metrics.find((m) => m.key === "brand_mention_rate")?.value).toBe(0.5);
    expect(result.metrics.find((m) => m.key === "brand_citation_rate")?.value).toBe(0.5);
    expect(result.metrics.find((m) => m.key === "official_citation_rate")?.value).toBe(0.5);
  });

  it("未配置官网时官网引用率不可计算", () => {
    const result = computeAnswerMetrics({
      corpus: [item({})],
      brand: { name: "元宝", aliases: [], websiteDomain: null },
      competitors: [],
    });
    const official = result.metrics.find((m) => m.key === "official_citation_rate");
    expect(official?.value).toBeNull();
    expect(official?.insufficient).toBe(true);
    expect(official?.notes).toContain("未配置官网域名");
  });

  it("竞品提及率使用同一分母", () => {
    const result = computeAnswerMetrics({
      corpus: [
        item({ runId: "a", answer: "豆包和元宝都不错" }),
        item({ runId: "b", answer: "只说元宝" }),
        item({ runId: "c", answer: "无关" }),
      ],
      brand,
      competitors: [{ id: "c1", name: "豆包", aliases: [] }],
    });
    const competitor = result.metrics.find((m) => m.key === "competitor_mention_rate:c1");
    expect(competitor?.denominator).toBe(3);
    expect(competitor?.value).toBeCloseTo(1 / 3, 5);
  });

  it("关键词表现按问题文本分组", () => {
    const result = computeAnswerMetrics({
      corpus: [
        item({ runId: "a", question: "GEO 优化怎么做", answer: "元宝可以" }),
        item({ runId: "b", question: "GEO 工具推荐", answer: "没有提到" }),
        item({ runId: "c", question: "今天天气", answer: "元宝无关" }),
      ],
      brand,
      competitors: [],
      keywords: ["GEO"],
    });
    const kpi = result.metrics.find((m) => m.key === "keyword_breakdown");
    const rows = kpi?.breakdown as Array<{ keyword: string; answers: number; brandMentioned: number }>;
    expect(rows[0]?.keyword).toBe("GEO");
    expect(rows[0]?.answers).toBe(2);
    expect(rows[0]?.brandMentioned).toBe(1);
  });

  it("按日趋势不生成无数据日期", () => {
    const result = computeAnswerMetrics({
      corpus: [
        item({ runId: "a", answeredAt: "2026-10-01T10:00:00.000Z", answer: "元宝" }),
        item({ runId: "b", answeredAt: "2026-10-03T10:00:00.000Z", answer: "无关" }),
      ],
      brand,
      competitors: [],
    });
    const trend = result.metrics.find((m) => m.key === "daily_trend");
    const rows = trend?.breakdown as Array<{ date: string; answers: number }>;
    expect(rows.map((r) => r.date)).toEqual(["2026-10-01", "2026-10-03"]);
    expect(rows).toHaveLength(2);
  });
});

describe("问题集维度补充指标", () => {
  it("空样本标注不可计算", () => {
    const metric = computeLabQuestionSetBreakdown([]);
    expect(metric.value).toBeNull();
    expect(metric.insufficient).toBe(true);
  });

  it("按问题集计算品牌出现率", () => {
    const metric = computeLabQuestionSetBreakdown([
      { questionSet: "品牌认知", validQuestions: 4, brandAppeared: 1 },
      { questionSet: "产品推荐", validQuestions: 2, brandAppeared: 2 },
    ]);
    expect(metric.denominator).toBe(6);
    expect(metric.numerator).toBe(3);
    expect(metric.value).toBe(0.5);
    const rows = metric.breakdown as Array<{ questionSet: string; rate: number }>;
    expect(rows[0]?.rate).toBe(0.25);
  });
});
