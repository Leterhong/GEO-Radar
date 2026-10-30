# @geo-radar/dsh-native

Native DSH/Cordis tool plugin for GEO Radar. It registers tools directly with
`ctx.tools.register(defineTool(...))`; it does not depend on the MCP bridge.

## Difference from `@geo-radar/dsh-plugin`

| | Native | MCP bridge |
| --- | --- | --- |
| Entry | Cordis `apply(ctx)` + `ctx.tools.register` | `@deepseek-ai/dsh-mcp-client` |
| Tool names | `geo_*` | `mcp__geo-radar__geo_*` |
| Protocol | In-process DSH tool registry | MCP stdio |
| Use when | DSH supports native tools | Any MCP-capable DSH build |

Do not enable both packages in the same profile unless you deliberately want
duplicate tool names.

## Install

```bash
npm run token:create -- you@example.com "DSH native"
export GEO_RADAR_URL=http://127.0.0.1:3000
export GEO_RADAR_TOKEN=gr_...
node scripts/install-dsh-native.mjs
cd packages/geo-radar-dsh
dsh plugin --profile desktop add .
```

The generated `cordis.patch.yml` contains the endpoint, tool package name and
token; it is gitignored and must not be committed.

## DSH version

- Bundle format tested with `@deepseek-ai/dsh@0.1.5-rc.3` in an isolated profile.
- Install the CLI with Node 24 recommended:

```bash
npm install -g @deepseek-ai/dsh@0.1.5-rc.3
dsh --version
```

Node 23 may not execute the published `bin.js` self-entry (`import.meta.main`);
use Node 24 or the DSH desktop app's CLI for real loading. Do not patch DSH core.
- Uses the official `@deepseek-ai/dsh-tools` + `@deepseek-ai/cordis` services.

## Tools

```text
geo_search_web
geo_batch_search
geo_list_evidence
geo_get_evidence
geo_analyze_brand
geo_analyze_domain
geo_compare_competitors
geo_analyze_citations
geo_generate_report
```

## Safety

- REAL search requires `confirmReal=true`; MOCK is free.
- A read-only token returns `403 TOKEN_SCOPE_DENIED` on writes.
- The plugin calls no model by default.
- It calls the GEO Radar Core API; it does not duplicate search or metric logic.

## Verification boundary

`index.js` can be imported and inspected without DSH, but actual registration
requires a DSH host with `@deepseek-ai/dsh-tools` and `tools` service. If the
current DSH CLI is unavailable, mark install/load as unverified, not passed.
