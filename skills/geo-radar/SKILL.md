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

| Tool | Use |
| --- | --- |
| `geo_list_brands` | find `brandId` |
| `geo_list_question_sets` | find a fixed question set |
| `geo_list_tasks` | find baseline/retest task IDs |
| `geo_get_task` | per-question status, results, duration, RequestId |
| `geo_wait_for_task` | poll a running task |
| `geo_get_matrix` | brand × competitor evidence matrix |
| `geo_get_evidence` | page-level evidence + raw metadata + reviews |
| `geo_compare_rounds` | two-round comparison and volatility |
| `geo_create_task` | create a QUEUED task (does not call search) |
| `geo_start_task` | start a task; REAL requires `confirmReal=true` |
| `geo_create_report` | freeze an evidence report |
| `geo_get_report` | read a generated report |

## Safe workflow

1. `geo_list_brands` → confirm the brand.
2. `geo_list_question_sets` → confirm the question set/version.
3. `geo_list_tasks` → find a baseline and a retest.
4. `geo_get_matrix` → read counts and metrics; **do not** infer beyond the sample.
5. `geo_get_evidence` → verify a specific claim by URL/RequestId.
6. `geo_compare_rounds` → report common questions, movement, page diff and data quality.
7. `geo_create_report` → freeze the report; never edit historical numbers by hand.

### Real vs Mock

- `MOCK` tasks are free and clearly labeled; they must not be presented as real search results.
- `REAL` tasks call Tencent Cloud Yuanbao SearchPro and may cost quota.
- **Never** call `geo_start_task` on a `REAL` task unless the user explicitly approved the cost. The tool requires `confirmReal=true`.
- Failure, empty result, not-found and needs-review are different states; do not merge them.

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
- `403 SESSION_REQUIRED`: token management must use the browser session; create tokens via CLI.
- `NO_WORKSPACE`: the token's workspace was deleted.
- `TASK_NOT_FOUND`: the task belongs to another workspace.
- MCP tool missing: verify the server path and restart the client.
