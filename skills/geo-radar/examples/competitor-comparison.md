# Example: competitor comparison

## User request

“比较元宝、豆包、Kimi 在同一组问题里的出现率。”

## Flow

1. `geo_list_brands` → `brandId`.
2. `geo_compare_competitors({ brandId, days: 30 })`.
3. Confirm both brand and competitors use the same valid-question denominator.
4. If sample sizes differ, explicitly flag them.
5. Drill into a competitor question with `geo_list_evidence` / `geo_search_evidence`.

## Output template

```text
Same 10 valid questions for all entities:
- Brand: 60%
- Competitor A: 70%
- Competitor B: 70%
Sample size and time range: ...
This is a search-result sample, not a claim about all AI answers.
```
