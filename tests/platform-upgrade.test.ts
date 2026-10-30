import { describe, expect, it } from "vitest";
import { brandSchema, competitorSchema, optimizationTaskUpdateSchema } from "@/lib/validation/schemas";

describe("platform upgrade schemas", () => {
  it("accepts brand English name and product metadata", () => {
    const parsed = brandSchema.safeParse({
      name: "元宝",
      englishName: "Yuanbao",
      aliases: ["腾讯元宝"],
      websiteUrl: "https://yuanbao.tencent.com",
      products: ["元宝搜索"],
      productAliases: ["SearchPro"],
      industry: "AI 搜索",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts competitor status, industry and products", () => {
    const parsed = competitorSchema.safeParse({
      brandId: "brand_1",
      name: "豆包",
      aliases: ["Doubao"],
      websiteUrl: "https://www.doubao.com",
      industry: "AI 助手",
      products: ["豆包"],
      enabled: false,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.enabled).toBe(false);
  });

  it("allows the needs-verification optimization state", () => {
    expect(optimizationTaskUpdateSchema.safeParse({ status: "NEEDS_VERIFICATION" }).success).toBe(true);
    expect(optimizationTaskUpdateSchema.safeParse({ status: "DONE" }).success).toBe(true);
    expect(optimizationTaskUpdateSchema.safeParse({ status: "UNKNOWN" }).success).toBe(false);
    expect(optimizationTaskUpdateSchema.safeParse({ pageUrl: "https://example.com/products/a" }).success).toBe(true);
  });
});
