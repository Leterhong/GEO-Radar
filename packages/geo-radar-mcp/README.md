# @geo-radar/mcp

MCP (stdio) server for GEO Radar. It exposes real search, stored evidence, analysis and reports to Claude Code, Cursor, DSH and any MCP client.

The server is an adapter over GEO Radar's existing REST APIs. It does not implement a second search/analysis pipeline.

## Requirements

- Node.js 20+
- A running GEO Radar instance
- A workspace API token (read-only or read/write)

```bash
cd /path/to/GEO-Radar
npm ci
npm run token:create -- you@example.com "MCP token"
```

## Environment

```bash
GEO_RADAR_URL=http://127.0.0.1:3000
GEO_RADAR_TOKEN=gr_...
```

`GEO_RADAR_URL` is the origin, not `/api`. The token is read from the environment only; it is never printed by tools.

## Client configuration

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

For a standalone checkout:

```bash
cd packages/geo-radar-mcp
npm install
GEO_RADAR_URL=http://127.0.0.1:3000 \
GEO_RADAR_TOKEN=gr_... \
node index.mjs
```

## Tools

### Search

| Tool | Description |
| --- | --- |
| `geo_search_web` | one query → normal GEO Radar task → results/evidence. Defaults to MOCK; REAL requires `confirmReal=true` |
| `geo_batch_search` | up to 10 queries in one task |

Ad hoc searches are stored as tasks but do not belong to a reusable question set. For reproducible long-term monitoring and reports, create tasks from a question set.
| `geo_create_task` | create a QUEUED task from a question set; does not call search |
| `geo_start_task` | start a task; REAL requires `confirmReal=true` |
| `geo_wait_for_task` | poll a task |
| `geo_list_tasks` | recent tasks |
| `geo_get_task` | per-question status, results, RequestId |

### Evidence

| Tool | Description |
| --- | --- |
| `geo_list_evidence` | filter by brand/domain/task/page type/review status |
| `geo_search_evidence` | full-text search stored evidence |
| `geo_get_evidence` | one evidence row, raw metadata and review history |
| `geo_analyze_citations` | cited domains and page types |
| `geo_export_evidence_csv` | export filtered evidence as CSV content (default) or a safe local file |

### CSV output modes

`geo_export_evidence_csv` defaults to `outputMode: "content"` and returns CSV text.
Set `GEO_RADAR_EXPORT_DIR` to an absolute directory to enable:

```text
geo_export_evidence_csv({
  brand: "元宝",
  outputMode: "file",
  filename: "geo-evidence.csv"
})
```

File mode writes on the **MCP host** (not the GEO Radar web server), only inside
`GEO_RADAR_EXPORT_DIR`, rejects path traversal/unsafe filenames, avoids overwrite,
and returns the real path. It does not create a download URL.

### Analysis

| Tool | Description |
| --- | --- |
| `geo_analyze_brand` | mention, question, official and third-party metrics + trend |
| `geo_analyze_domain` | page type/source role coverage |
| `geo_compare_competitors` | same-denominator competitor comparison |
| `geo_compare_rounds` | two-round comparison and volatility |
| `geo_list_brands` | find a brand ID |
| `geo_list_question_sets` | find a question set |

### Reports

| Tool | Description |
| --- | --- |
| `geo_generate_report` | report for a REAL task, optional baseline comparison |
| `geo_get_report` | metadata + preview; `includeMarkdown=true` for full |

## Examples

```text
geo_search_web({
  query: "AI 搜索助手有哪些",
  brandId: "...",
  executionMode: "MOCK",
  maxResults: 5
})
```

```text
geo_analyze_brand({ brandId: "...", days: 30 })
geo_compare_competitors({ brandId: "...", days: 30 })
geo_generate_report({ taskId: "...", compareTaskId: "...", title: "GEO 复测报告" })
geo_export_evidence_csv({ brand: "元宝", query: "搜索", limit: 200 })
```

## Safety

- `MOCK` is not real search; label it.
- Real search can spend API quota. `geo_search_web` / `geo_batch_search` / `geo_start_task` require `confirmReal=true` for REAL.
- A read-only token can query but returns `403 TOKEN_SCOPE_DENIED` on writes.
- The server never invents search results, metrics or citations.
- Do not put tokens in the repository or logs.

## Troubleshooting

| Error | Fix |
| --- | --- |
| `401 INVALID_TOKEN` | recreate the token; check workspace |
| `403 TOKEN_SCOPE_DENIED` | use a read/write token |
| `PROVIDER_NOT_CONFIGURED` | configure Yuanbao SearchPro in Settings |
| `PROVIDER_NOT_CONNECTED` | run the SearchPro connection test |
| `fetch failed` | check `GEO_RADAR_URL` and that the app is running |
| tools missing | restart the MCP client after changing config |

## Test

```bash
GEO_RADAR_URL=http://127.0.0.1:3000 \
GEO_RADAR_TOKEN=gr_... \
npm run smoke:mcp
```

The smoke test verifies tool registration and basic reads. Real SearchPro calls are not made by the smoke test.

File mode smoke:

```powershell
$env:GEO_RADAR_EXPORT_DIR=(Resolve-Path .tmp-export-test).Path
npm run smoke:mcp:export
```

This checks content mode, real file writing, Chinese/BOM, overwrite avoidance,
path traversal rejection and unauthorized directory rejection.
