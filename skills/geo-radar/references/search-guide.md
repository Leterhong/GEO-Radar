# Search Guide

## Real vs Mock

- `executionMode: "REAL"` calls Tencent Cloud Yuanbao SearchPro and may cost quota.
- `executionMode: "MOCK"` is deterministic test data and must be labeled as Mock.
- REAL requires the server to have `YUANBAO_SEARCH_ENABLED=true`, a configured API key and a passed connection test.
- NEVER start a REAL task without explicit user approval.

## Query design

- One query = one search question.
- Keep the user's intent; don't stuff keywords.
- For comparison, use the same question set for baseline and retest.
- Avoid questions that require private/account data the search provider cannot access.

## Tool flow

```text
geo_search_web({ query, brandId?, executionMode: "MOCK", maxResults })
geo_batch_search({ queries, brandId?, executionMode: "MOCK" })
```

For REAL:

```text
geo_search_web({ query, executionMode: "REAL", confirmReal: true })
```

The MCP server creates a normal GEO Radar task, starts it, waits for completion, and returns per-question results.

## Failure handling

- `PROVIDER_NOT_CONFIGURED`: configure Yuanbao SearchPro.
- `PROVIDER_NOT_CONNECTED`: run the connection test.
- `429`: back off; do not retry aggressively.
- timeout: report it and inspect the task instead of inventing results.
- empty result: it is an empty result, not “brand does not exist”.
