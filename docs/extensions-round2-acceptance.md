# GEO Radar 第二轮收尾验收报告

日期：2026-10-30  
范围：DSH boot/重启/工具发现、DSH Native execute、Claude Skill、SearchPro 矩阵、MCP CSV 文件模式。

## 问题定位表

| 问题 | 当前实现 | 失败原因 | 修改方案 | 验收方式 |
|---|---|---|---|---|
| DSH boot 失败 | `@deepseek-ai/dsh@0.1.5-rc.3` + native bundle | 本地隔离 CLI 运行依赖不完整：`sharp`、Koffi、`typebox/build/typebox.mjs` 等 | 补齐 native 包依赖；区分外部 DSH 安装问题与插件问题 | `dsh --profile ...` 启动日志、`--dump-config` |
| 插件找不到 dsh-tools | `index.js` 静态导入 `@deepseek-ai/dsh-tools`，包仅声明 peer | linked package 的外层 profile 不提供该模块解析 | 增加 `dependencies` 并执行包内 `npm install` | DSH loader 日志 / 包解析 |
| Native execute 未实际调用 | 只有 fake `ctx.tools.register` | 未运行真实 ToolRuntime | 用官方 `ToolRuntime` 注册并调用 3 个工具 | `scripts/dsh-native-smoke.mjs` |
| Claude CLI 超时 | Skill 已安装，`claude -p` 无响应 | `/v1/messages` 返回 401 Invalid token，CLI 重试 11 次 | 不做代码伪造；记录 auth 为根因，提供本地复测命令 | Claude debug log |
| SearchPro 覆盖不足 | 只有 4 个真实 Query | 没有测试矩阵 | 增加 10 类 MOCK 矩阵 + REAL 显式授权脚本 | `searchpro:matrix` |
| CSV 只有内容 | `geo_export_evidence_csv` 返回文本 | 没有落盘模式 | 增加 `outputMode=file`，允许目录限制、路径穿越防护、唯一文件名 | MCP export smoke |
| CSV BOM 被 fetch 去掉 | `Response.text()` 剥离 BOM | Excel 中文可能乱码 | MCP 侧恢复 BOM | 文件/内容 smoke |

## 最终状态

| 编号 | 验收内容 | 状态 | 实际证据 |
|---|---|---|---|
| 1 | DSH 真实 boot | **待验证** | 安装和配置 dump 成功；boot 在外部 DSH 依赖 `typebox/build/typebox.mjs` 处失败 |
| 2 | DSH 重启 | **待验证** | 未完成可运行 boot，不能声称重启通过 |
| 3 | DSH 工具发现 | **待验证** | 未完成完整 DSH Agent 启动；Native 工具已通过独立 ToolRuntime 发现 |
| 4 | Native execute() | **通过（ToolRuntime 服务级）** | 3 个工具实际执行成功；非法参数被拒绝；见 `docs/dsh-native-execute-record.json` |
| 5 | Claude Skill 发现 | **通过** | 用户 skills 目录 28 个；临时移出后 27 个；恢复后 28 个 |
| 6 | Claude Skill 实际调用 | **待验证** | Claude API 401 Invalid token；MCP 连接成功但模型调用被阻断 |
| 7 | SearchPro 测试矩阵 | **通过（MOCK）/ 真实待授权** | 10 类 10/10 完成；未消耗真实额度 |
| 8 | SearchPro 真实 API | **通过（上一轮 4 Query）** | task `cmvuudpcx002riouxe9rti2iv`，4/4，40 证据；本轮矩阵未授权 |
| 9 | CSV 内容返回 | **通过** | 2,199 bytes / 1 行内容模式 |
| 10 | CSV 文件落盘 | **通过** | 10,944 bytes / 5 行真实文件；空结果 138 bytes；路径穿越/越界目录/超限均拒绝 |

## 实际执行

### 自动化回归

```text
npm run typecheck  PASS
npm run lint       PASS
npm test           131 passed (131), 9 files
npm run build      Compiled successfully
```

### MCP

```text
npm run smoke:mcp
TOOLS 22
MCP SMOKE PASSED

npm run smoke:mcp:export
MCP CSV EXPORT PASSED
```

文件输出示例：

```text
G:\GEO Radar\.tmp-export-test\geo-test-3.csv
bytes=10944, rows=5
```

### Native execute

```text
toolCount=9
geo_analyze_brand      ok   5948ms
geo_list_evidence      ok   212ms
geo_search_web (MOCK)  ok   1970ms
geo_analyze_domain     rejected: missing required property "brandId"
```

记录：`docs/dsh-native-execute-record.json`

### SearchPro MOCK 矩阵

```text
mode=MOCK
total=10
completed=10
failed=0
empty=0
categories=10
```

记录：`docs/searchpro-matrix.md`

### Claude

Discovery pass:

```text
Loaded 28 unique skills ... user: 28
```

Control:

```text
move geo-radar out => Loaded 27 unique skills
restore            => 28
```

MCP transport:

```text
MCP server "geo-radar": Successfully connected (transport: stdio)
capabilities: {"hasTools":true,...}
```

Model call blocked:

```text
401 Invalid token
```

记录：`docs/claude-skill-discovery.md`

## DSH boot 证据

安装：

```text
+ @geo-radar/dsh-native link:C:/geo-radar-dsh
Done in 1.1s using pnpm v11.1.3
```

profile config dump：

```yaml
- id: geo-radar-native
  name: '@geo-radar/dsh-native'
  config:
    baseUrl: http://127.0.0.1:3000
```

补齐 native 包依赖后，DSH loader 已不再报 `Cannot find package
'@deepseek-ai/dsh-tools'`。随后 boot 失败在 DSH 自身安装：

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'.../.tmp-dsh-full/node_modules/typebox/build/typebox.mjs'
imported from .../typebox/build/index.mjs
```

这是隔离 CLI 的第三方包安装不完整，不是 GEO Radar 工具执行错误；因此 boot
状态仍为待验证，不能改写为通过。

## 未解决 / 需要用户环境

1. DSH full Web/headless boot：隔离 CLI 的 `typebox/build/typebox.mjs` 缺失；需要完整 DSH Desktop 或修复 DSH 安装依赖。
2. DSH Agent 级工具调用：Native execute 已在 ToolRuntime 服务级通过，但未在完整 DSH Agent 会话内执行。
3. Claude 实际模型/工具调用：需要有效 Claude 登录/API key；当前 401，不能伪造。
4. SearchPro 10 类 REAL 矩阵：需要显式授权；此前 4 Query 真实测试通过，不代表矩阵已跑。
5. CSV 文件路径是 MCP 主机路径；没有实现下载 URL（当前无安全下载服务）。

## 用户本地复测

```powershell
# DSH Native
npm install -g @deepseek-ai/dsh@0.1.5-rc.3
node scripts/install-dsh-native.mjs
cd packages/geo-radar-dsh
npm install
dsh plugin --profile desktop add .
dsh --profile desktop

# Native service-level test
npm install --prefix .dsh-tools @deepseek-ai/dsh-tools@0.1.5-rc.3
$env:DSH_TOOLS_DIR=(Resolve-Path .dsh-tools/node_modules).Path
$env:GEO_RADAR_TOKEN="gr_..."
$env:GEO_RADAR_URL="http://127.0.0.1:3000"
node scripts/dsh-native-smoke.mjs

# CSV file mode
$env:GEO_RADAR_EXPORT_DIR="G:\geo-exports"
$env:GEO_RADAR_TOKEN="gr_..."
npm run smoke:mcp:export

# SearchPro REAL matrix (costs quota; only after approval)
$env:CONFIRM_REAL_SEARCH="1"
$env:SEARCHPRO_BRAND_ID="cmvrogw69000bmrhmnt55fgem"
npm run searchpro:matrix -- --real
```
