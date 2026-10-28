import { createHash } from "crypto";
import type { SearchRequest } from "@/lib/providers/types";

const MOCK_SITES = [
  { site: "知乎", domain: "zhihu.com" },
  { site: "36氪", domain: "36kr.com" },
  { site: "少数派", domain: "sspai.com" },
  { site: "腾讯云开发者社区", domain: "cloud.tencent.com" },
  { site: "掘金", domain: "juejin.cn" },
];

export interface MockSearchResult {
  title: string;
  url: string;
  date: string;
  passage: string;
  site: string;
  score: number;
  favicon: string;
}

/**
 * Mock 模式：确定性生成演示结果（按 query 哈希固定）。
 * 所有结果带有 isMock 标记，不进入真实统计，不产生任何外部请求。
 */
export function buildMockPages(query: string, count: number): MockSearchResult[] {
  const seed = createHash("sha256").update(query).digest();
  const results: MockSearchResult[] = [];
  const n = Math.max(1, Math.min(count, 5));
  for (let i = 0; i < n; i += 1) {
    const tpl = MOCK_SITES[(seed[i] ?? i) % MOCK_SITES.length] ?? MOCK_SITES[0];
    if (!tpl) continue;
    const day = ((seed[(i + 3) % seed.length] ?? i) % 27) + 1;
    results.push({
      title: `【模拟数据】${query} — ${tpl.site}视角解读`,
      url: `https://${tpl.domain}/mock/${seed.subarray(i, i + 4).toString("hex")}`,
      date: `2026-09-${String(day).padStart(2, "0")}`,
      passage: `这是关于“${query}”的模拟搜索摘要，仅用于开发与功能演示，不代表真实搜索结果，也不代表任何品牌的真实搜索表现。（来源：${tpl.site}）`,
      site: tpl.site,
      score: Number((0.55 + ((seed[(i + 7) % seed.length] ?? 0) % 40) / 100).toFixed(2)),
      favicon: "",
    });
  }
  return results;
}
