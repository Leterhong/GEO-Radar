# @geo-radar/dsh-plugin

DSH plugin that mounts the GEO Radar MCP server as native DSH tools:

```text
mcp__geo-radar__geo_search_web
mcp__geo-radar__geo_analyze_brand
mcp__geo-radar__geo_list_evidence
mcp__geo-radar__geo_compare_competitors
mcp__geo-radar__geo_generate_report
...
```

This is a **DSH bundle declaration** plugin. It inserts the official
`@deepseek-ai/dsh-mcp-client` bridge into the profile. GEO Radar business logic
stays in the GEO Radar Core API; the plugin does not duplicate search or metrics.

## DSH version

- Tested against the DSH plugin bundle format used by current DSH desktop builds.
- Uses the official `@deepseek-ai/dsh-mcp-client` package.
- No DSH core source files are modified.

## Install

From the GEO Radar repo:

```bash
# 1. token (printed once)
npm run token:create -- you@example.com "DSH MCP"

# 2. endpoint + token
export GEO_RADAR_URL=http://127.0.0.1:3000
export GEO_RADAR_TOKEN=gr_...

# 3. generate the patch with absolute MCP path
node scripts/install-dsh-plugin.mjs

# 4. install into the profile actually used by DSH
#    desktop app: often "desktop"; web: "web"
dsh plugin --profile desktop add "$PWD/packages/dsh-geo-radar"
```

Windows PowerShell:

```powershell
$env:GEO_RADAR_URL = "http://127.0.0.1:3000"
$env:GEO_RADAR_TOKEN = "gr_..."
# optional: $env:DSH_PROFILE = "desktop"
node scripts/install-dsh-plugin.mjs
dsh plugin --profile desktop add "$PWD\packages\dsh-geo-radar"
```

Restart DSH after installing. `dsh.profile.bundles` is read at boot.

## Configuration

The installer creates `packages/dsh-geo-radar/cordis.patch.yml` with:

```yaml
- insert:
    - id: mcp-geo-radar
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: geo-radar
        transport: stdio
        command: node
        args:
          - '/absolute/path/to/GEO-Radar/packages/geo-radar-mcp/index.mjs'
        env:
          GEO_RADAR_URL: 'http://127.0.0.1:3000'
          GEO_RADAR_TOKEN: 'gr_...'
```

The file contains a token and is gitignored. Use a read-only token if the Agent
only needs evidence/analysis; use a read/write token for search or report generation.

## Tools exposed in DSH

Search:

```text
mcp__geo-radar__geo_search_web
mcp__geo-radar__geo_batch_search
mcp__geo-radar__geo_create_task
mcp__geo-radar__geo_start_task
```

Evidence:

```text
mcp__geo-radar__geo_list_evidence
mcp__geo-radar__geo_search_evidence
mcp__geo-radar__geo_get_evidence
```

Analysis:

```text
mcp__geo-radar__geo_analyze_brand
mcp__geo-radar__geo_analyze_domain
mcp__geo-radar__geo_compare_competitors
mcp__geo-radar__geo_analyze_citations
```

Reports:

```text
mcp__geo-radar__geo_generate_report
mcp__geo-radar__geo_get_report
```

## Safety

- `REAL` search requires explicit `confirmReal=true`; ask the user first.
- `MOCK` is not real search.
- A read-only token returns `403 TOKEN_SCOPE_DENIED` on writes.
- The plugin does not call a model by default.
- Do not commit `cordis.patch.yml` or the token.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| No `mcp__geo-radar__*` tools | restart DSH; confirm the profile matches the running app |
| MCP starts but calls fail | check `GEO_RADAR_URL`; app must be running |
| `401 INVALID_TOKEN` | create a new token |
| `403 TOKEN_SCOPE_DENIED` | use a read/write token |
| `PROVIDER_NOT_CONFIGURED` | configure Yuanbao SearchPro |
| Wrong profile | use `--profile desktop` or `--profile web` matching `DSH_HOME` |

## Uninstall

```bash
dsh plugin --profile desktop remove @geo-radar/dsh-plugin
```

Then restart DSH. Remove the generated `cordis.patch.yml` if it remains.

## Verification boundary

The package manifest, `dsh.bundle.patch`, YAML parsing and `npm pack` contents are
covered by the repository checks. Actual `dsh plugin add` + restart requires a
working DSH CLI/profile and is not claimed as passed when that environment is absent.
