# @geo-radar/dsh-plugin

DSH plugin declaration that mounts the GEO Radar MCP server into DSH as:

```text
mcp__geo-radar__geo_list_brands
mcp__geo-radar__geo_get_matrix
mcp__geo-radar__geo_compare_rounds
...
```

This package is a **pure declaration** DSH plugin. It does not contain UI code; it inserts one
`@deepseek-ai/dsh-mcp-client` row into the profile.

## Install

From the GEO Radar repo:

```bash
# 1. Get a workspace token (printed once)
npm run token:create -- you@example.com "DSH MCP"

# 2. Put URL + token in the environment
export GEO_RADAR_URL=http://127.0.0.1:3000
export GEO_RADAR_TOKEN=gr_...

# 3. Generate the patch with the absolute MCP server path
node scripts/install-dsh-plugin.mjs

# 4. Install this plugin into the DSH profile and restart DSH
dsh plugin --profile web add "$PWD/packages/dsh-geo-radar"
```

On Windows PowerShell:

```powershell
$env:GEO_RADAR_URL = "http://127.0.0.1:3000"
$env:GEO_RADAR_TOKEN = "gr_..."
node scripts/install-dsh-plugin.mjs
dsh plugin --profile web add "$PWD\packages\dsh-geo-radar"
```

Restart DSH after installing. Tools appear after the next boot.

## What the generated patch looks like

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

`cordis.patch.yml` is generated locally and is gitignored because it contains a token.

## Troubleshooting

- **No `mcp__geo-radar__*` tools**: restart DSH; `dsh.profile.bundles` is read at boot.
- **Wrong DSH_HOME**: the plugin only applies to the profile tree DSH is actually booting.
- **MCP starts but tools fail**: check `GEO_RADAR_URL` and that the app is running.
- **401**: create a new token with `npm run token:create`.
- **Need to uninstall**: `dsh plugin --profile web remove @geo-radar/dsh-plugin`.

## Safety

The MCP server exposes `geo_start_task`. For `REAL` tasks it requires `confirmReal=true`; still,
only start a real task when the user explicitly approved the cost.
