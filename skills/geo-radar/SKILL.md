---
name: geo-radar
description: Inspect real AI-search evidence in GEO Radar — list brands/tasks, read page-level evidence, compare two rounds and generate a report. Use when a user asks about AI search visibility, brand mentions, Yuanbao Search results, GEO evidence or a GEO report.
---

# GEO Radar Skill

Use this skill when the user wants to:

- check whether a brand appears in real AI-search results;
- inspect which pages mention a brand or competitor;
- compare two retrieval rounds;
- generate an evidence-centered GEO report;
- audit a Yuanbao Search task.

GEO Radar is **evidence-first**: metrics must come from stored search results. Never invent a rate, a citation or a search result.

## Prerequisites

One running GEO Radar instance and one workspace API token:

```bash
# in the GEO Radar repo
npm run token:create -- you@example.com "MCP token"
# prints GEO_RADAR_TOKEN only once
```

Set:

```bash
GEO_RADAR_URL=http://127.0.0.1:3000
GEO_RADAR_TOKEN=gr_...
```

If the MCP tools `geo_list_brands`, `geo_get_matrix`, etc. are available, use them directly. Otherwise launch the MCP server from this repo:

```bash
node packages/geo-radar-mcp/index.mjs
```

## MCP client configuration

### Claude Code / Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "geo-radar": {
      "command": "node",
      "args": ["/absolute/path/to/GEO-Radar/packages/geo-radar-mcp/index.mjs"],
      "env": {
        "GEO_RADAR_URL": "http://127.0.0.1:3000",
        "GEO_RADAR_TOKEN": "gr_..."
      }
    }
  }
}
```

### DSH

```bash
# from the GEO Radar repo, with GEO_RADAR_URL and GEO_RADAR_TOKEN set
node scripts/install-dsh-plugin.mjs
dsh plugin --profile web add "$PWD/packages/dsh-geo-radar"
# restart DSH; tools appear as mcp__geo-radar__geo_*
```

## Tools

### Discovery and search

| Tool | Use |
| --- | --- |
| `geo_list_brands` | find `brandId` |
| `geo_list_question_sets` | find a fixed question set |
| `geo_search_web` | run one real/MOCK query; REAL requires `confirmReal=true` |
| `geo_batch_search` | run up to 10 queries in one task |
| `geo_list_tasks` | find baseline/retest task IDs |
| `geo_get_task` | per-question status, results, duration, RequestId |
| `geo_wait_for_task` | poll a running task |
| `geo_get_matrix` | brand × competitor evidence matrix |
| `geo_create_task` | create a QUEUED task from a question set |
| `geo_start_task` | start a task; REAL requires `confirmReal=true` |

### Evidence

| Tool | Use |
| --- | --- |
| `geo_list_evidence` | filter stored evidence by brand/domain/task/pageType/status |
| `geo_search_evidence` | full-text search stored evidence |
| `geo_get_evidence` | one evidence row + raw metadata + reviews |

### Analysis and reports

| Tool | Use |
| --- | --- |
| `geo_analyze_brand` | brand visibility metrics/trend/sources |
| `geo_analyze_domain` | official/third-party/page-type coverage |
| `geo_compare_competitors` | same-denominator competitor comparison |
| `geo_analyze_citations` | cited domains/page types |
| `geo_compare_rounds` | two-round comparison and volatility |
| `geo_generate_report` | generate a frozen REAL-task report |
| `geo_get_report` | read report metadata/preview; `includeMarkdown=true` for full |

## Safe workflow

### Brand visibility

1. `geo_list_brands` → confirm the brand.
2. `geo_analyze_brand` → read existing metrics; if there is no data, `geo_search_web` with MOCK or approved REAL.
3. `geo_list_evidence` → verify representative pages.
4. `geo_generate_report` only if the user asks for a frozen report.

### Competitor comparison

1. Confirm all entities use the same question set/version.
2. `geo_compare_competitors` → read rates and sample sizes.
3. `geo_search_evidence` → verify a specific competitor claim.

### Optimization before/after

1. Identify baseline and retest task IDs.
2. `geo_compare_rounds` → common questions, page diff, quality, volatility.
3. Link the recorded optimization event/page URL.
4. State observed change separately from causality.

### Real vs Mock

- `MOCK` results are deterministic test data and must be labeled as Mock.
- `REAL` calls Tencent Cloud Yuanbao SearchPro and may cost quota.
- **Never** run `REAL` unless the user explicitly approved the cost. Both search tools require `confirmReal=true`.
- Failure, empty result, not-found and needs-review are different states.

## References

- [Search guide](references/search-guide.md)
- [Evidence guide](references/evidence-guide.md)
- [Analysis guide](references/analysis-guide.md)
- [Report guide](references/report-guide.md)
- [Examples](examples/)

## Output rules

- State the sample: number of valid questions, results and failed/empty items.
- Give numerator/denominator for every rate.
- Link a representative evidence URL and its `RequestId` when making a claim.
- Say “not computable” when the denominator is zero or the sample is insufficient.
- Do not claim causality from a two-round comparison; volatility is an observed range, not a confidence interval.
- Never print API tokens, cookies or raw credentials.

## Example prompts

- “看一下元宝这个品牌最近一轮真实搜索的品牌提及率，并给我三条证据 URL。”
- “比较这两轮任务，哪些问题提升了，哪些页面新出现？”
- “为这个任务生成一份证据报告，并说明哪些指标不可计算。”
- “先创建一个 MOCK 任务验证流程，不要调用真实 API。”

## Failure handling

- `401`: check `GEO_RADAR_TOKEN` and that the token belongs to the workspace.
- `403 TOKEN_SCOPE_DENIED`: use a writable token for task/report creation; read-only tokens can only query.
- `403 SESSION_REQUIRED`: token management must use the browser session; create tokens via CLI.
- `NO_WORKSPACE`: the token's workspace was deleted.
- `TASK_NOT_FOUND`: the task belongs to another workspace.
- MCP tool missing: verify the server path and restart the client.
