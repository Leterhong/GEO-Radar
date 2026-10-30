# Example: brand AI-search visibility

## User request

“分析元宝在 AI 搜索里的品牌可见度，并给我可追溯证据。”

## Flow

1. `geo_list_brands` → find `brandId`.
2. `geo_analyze_brand({ brandId, days: 30 })`.
3. If no data, `geo_search_web` with a small MOCK task first; only run REAL after approval.
4. `geo_list_evidence` for representative pages.
5. Output:

```text
Brand appearance: 6/10 valid questions = 60%
Official coverage: 0/10 = 0% (configured but no official page in this sample)
Third-party coverage: 6/10 = 60%
Failed questions: 2 (excluded)
Evidence examples: <URL> | <URL>
Limitation: this is one search sample, not all AI platforms.
```

6. Generate report only if the user asks for a frozen report.
