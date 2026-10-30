# Claude Code Skill discovery record

Date: 2026-10-30  
Claude Code: 2.1.263  
Skill: `C:\Users\LENOVO\.claude\skills\geo-radar`

## A. Skill discovery — PASS

`claude --debug` startup log:

```text
Loading skills from: managed=..., user=C:\Users\LENOVO\.claude\skills, project=[]
Loaded 28 unique skills (28 unconditional, 0 conditional, managed: 0, user: 28, project: 0)
Sending 40 skills via attachment (initial)
```

Control check: temporarily moving `geo-radar` out of the user skills directory
produced `Loaded 27 unique skills`; restoring it produced 28. This proves the
GEO Radar Skill was discovered by Claude Code.

## B. Skill content read — BLOCKED

Claude Code could not send a model request:

```text
API error: 401 {"error":{"message":"Invalid token. ...","type":"shell_api_error"}}
```

It retried 11 times, which is why the CLI appeared to hang. This is an
authentication failure, not a Skill format failure. No model/tool-call record is
claimed.

## C. MCP server discovery — PASS (transport level)

Using a temporary `--mcp-config` with `GEO_RADAR_TOKEN`:

```text
MCP server "geo-radar": Starting connection with timeout of 30000ms
MCP server "geo-radar": Successfully connected (transport: stdio) in 4931ms
MCP server "geo-radar": Connection established with capabilities:
  {"hasTools":true,"hasPrompts":false,"hasResources":false,
   "serverVersion":{"name":"geo-radar","version":"0.1.0"}}
```

Direct MCP smoke separately listed 22 tools and passed actual calls.

## D. Actual Claude model/tool call — BLOCKED

The same 401 invalid token prevented any `/v1/messages` request, so no
`geo_list_evidence` / `geo_analyze_brand` call was made from Claude. Do not mark
this as passed. A valid `ANTHROPIC_API_KEY`/Claude login is required.

## Reproduce after fixing auth

```powershell
claude --version
$env:ANTHROPIC_API_KEY="<valid key>"   # or run: claude login
$env:GEO_RADAR_TOKEN="gr_..."
claude -p "Use geo-radar skill and call geo_list_evidence for brand 元宝, then summarize one title and URL." `
  --mcp-config .tmp-claude-mcp.json `
  --strict-mcp-config `
  --max-turns 3 `
  --output-format json
```
