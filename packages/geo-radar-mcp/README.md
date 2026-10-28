# @geo-radar/mcp

MCP server for GEO Radar. It exposes real evidence workspaces to Claude Code, Cursor, DSH and any MCP client.

## Install

From a cloned GEO Radar repository:

```bash
npm ci
npm run token:create -- you@example.com "MCP token"
```

Create the MCP client config:

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

For a standalone install:

```bash
cd packages/geo-radar-mcp
npm install
GEO_RADAR_URL=http://127.0.0.1:3000 \
GEO_RADAR_TOKEN=gr_... \
node index.mjs
```

## Tools

| Tool | Description |
| --- | --- |
| `geo_list_brands` | list brands in the token workspace |
| `geo_list_question_sets` | list fixed question sets and versions |
| `geo_list_tasks` | list recent tasks |
| `geo_get_task` | task + per-question status/RequestId |
| `geo_wait_for_task` | poll a task |
| `geo_get_matrix` | brand × competitor matrix |
| `geo_get_evidence` | page-level evidence detail |
| `geo_compare_rounds` | two-round comparison |
| `geo_create_task` | create a QUEUED task |
| `geo_start_task` | start a task; REAL needs `confirmReal=true` |
| `geo_create_report` | generate a frozen report |
| `geo_get_report` | read a report |

## Safety

- The MCP server never invents metrics or search results.
- `REAL` tasks can spend API quota. `geo_start_task` refuses REAL tasks unless `confirmReal=true`.
- Prefer MOCK for workflow tests.
- Tokens are workspace-scoped and can be revoked in the database/CLI.

## Notes

- Requires Node.js 20+ and a running GEO Radar instance.
- `GEO_RADAR_URL` must point to the GEO Radar origin, not `/api`.
- This package is not published to npm; it is distributed with the repository. A future release can publish it as a standalone package.
