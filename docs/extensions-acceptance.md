# GEO Radar 多生态扩展验收报告

日期：2026-10-30  
范围：Agent Skill、MCP Server、DSH MCP 桥接、DSH Native（Cordis）插件、SearchPro 真实链路、MCP CSV 导出。

## 验收状态

| 编号 | 验收项目 | 状态 | 证据/说明 |
| --- | --- | --- | --- |
| 1 | DSH 真实安装 | 部分通过 | 官方 CLI 0.1.5-rc.3 隔离安装；`dsh plugin add .` 成功；`native-headless` profile 的 bundles 已包含 `@geo-radar/dsh-native`，`--dump-config` 显示该行 |
| 2 | DSH 重启加载 | 待验证 | 启动 headless profile 时，本地 CLI 安装缺少 `sharp`、Koffi、`dsh-chunked-list`、`dsh-goal-round-driver` 等运行依赖，DSH 未能完成 boot；不能声称加载通过 |
| 3 | DSH 工具发现 | 待验证 | 未完成可运行的 DSH Agent 会话；未取得 `geo_search_web` 等工具的运行时发现记录 |
| 4 | Cordis 原生工具注册 | 部分通过 | `packages/geo-radar-dsh/index.js` 使用 `ctx.tools.register(defineTool(...))`；用假 `ctx` 验证注册出 9 个工具；未在真实 DSH tools service 中调用 |
| 5 | MCP 桥接兼容 | 通过 | MCP stdio smoke：22 个工具、brands、matrix、brand analysis、evidence、competitor comparison 全部返回 |
| 6 | Skill 第三方加载 | 部分通过 | 已安装到 Claude Code 的 `~/.claude/skills/geo-radar`；Claude CLI 实际调用超时，未取得 Agent 读取/调用记录 |
| 7 | SearchPro 真实 API | 通过（用户已授权） | 连接测试与 4 个真实 Query 均成功；见下文 RequestId |
| 8 | 证据链完整性 | 通过 | 4 个 Query → 4 个 RawSearchResponse → 40 条 Evidence → 32 个唯一规范化页面 |
| 9 | MCP CSV 导出 | 通过 | `geo_export_evidence_csv` 返回 46,934 bytes / 23 行 CSV，含中文、公式注入防护 |
| 10 | 自动化回归 | 通过 | typecheck、lint、127 tests、build、Docker Compose CI 全通过 |

## SearchPro 真实验证

配置：密钥经服务端加密写入，未写入 Git、未在输出中回显。

连接测试：

```text
success=true
durationMs=1558
requestId=0216bed0-9689-41fc-9f75-9bc9928d69e3
resultCount=10
```

真实任务：

```text
任务：cmvuudpcx002riouxe9rti2iv
问题：4
状态：COMPLETED
成功：4 / 4
结果：40
证据：40
唯一规范化页面：32
重复规范化 URL：0
缺失 RequestId 的证据：0
```

RequestId：

```text
17ce367d-549a-4bd9-b5dc-2f0bbfd6d108
feb3c5d4-cc23-4493-b99e-240dc298f7e5
460783ac-605c-4aa7-a7d5-d303d0972240
b2d5f6cf-62c3-473b-acbd-e8aefeb9592b
```

报告：

```text
reportId：cmvuudqqd0086ioux1h7fuy42
kind：SEARCH_EVIDENCE
```

指标样本（4 个有效问题，系统标记为 low sample）：

```text
品牌提及问题率 4/4 = 100%
官网结果覆盖率 1/4 = 25%
第三方页面覆盖率 4/4 = 100%
竞品豆包 2/4 = 50%
```

第一次真实测试使用 `maxResults=5` 被 SearchPro 拒绝：`Cnt only supports 10/20/30/40/50`。已修复 Core 与 MCP 的输入校验，避免创建后才失败。

## MCP CSV 导出

工具：

```text
geo_export_evidence_csv({
  brand: "元宝",
  query: "元宝",
  limit: 20
})
```

实测结果：

```text
filename: georadar-evidence-2026-10-30.csv
bytes: 46934
rowHint: 23
```

CSV 头：

```text
evidence_id,query,brand,title,url,snippet,site_name,score,request_id,
collected_at,source_type,page_type,mention_status,is_mock,task_id
```

安全：`csvEscape` 对 `= + - @` 开头字段加 `'`，并有单元测试。

## DSH 安装记录

使用官方 `@deepseek-ai/dsh@0.1.5-rc.3` 隔离安装，profile：

```text
DSH_HOME = <repo>/.tmp-dsh-home
profile = native-headless
```

官方 CLI 安装（Node 24 推荐）：

```powershell
npm install -g @deepseek-ai/dsh@0.1.5-rc.3
dsh --version
```

DSH CLI 的 `bin.js` 在 Node 23 下 `import.meta.main` 不会自动执行，本次用等价 wrapper
`import { runCli } from './.../bin.js'; await runCli()` 运行，不修改 DSH 源码。

安装输出：

```text
+ @geo-radar/dsh-native link:C:/geo-radar-dsh
Done in 1.1s using pnpm v11.1.3
```

profile 的 bundles：

```json
[
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "@geo-radar/dsh-native"
]
```

`--dump-config` 已显示：

```yaml
- id: geo-radar-native
  name: '@geo-radar/dsh-native'
  config:
    baseUrl: http://127.0.0.1:3000
    token: <redacted>
```

启动失败原因（未伪造为通过）：

```text
Could not load the "sharp" module
Cannot find the native Koffi module
Cannot find package '@deepseek-ai/dsh-chunked-list'
Cannot find package '@deepseek-ai/dsh-goal-round-driver'
```

这是当前隔离 CLI 安装缺少 DSH 运行依赖导致，不是 GEO Radar 工具代码的错误；
因此 DSH 重启/工具发现仍标记待验证。Desktop 应用自带更完整运行依赖，用户本地应按
README 在真实 desktop profile 中重启验证。

## DSH Native 代码验证

`packages/geo-radar-dsh/index.js` 使用：

```js
export const inject = ["tools"];
ctx.tools.register(defineTool({...}));
```

用假 `ctx.tools.register` 静态验证注册出 9 个工具：

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

未在真实 DSH tools service 中执行，因此状态为部分通过。

## 未完成事项

1. DSH 可运行 boot 与真实工具发现（缺 DSH client UI 依赖/可用 desktop profile 重启窗口）。
2. Skill 的 Claude Agent 实际调用记录（CLI 超时）。
3. DSH Native 的真实 `execute()` 调用记录；目前只有静态注册结构验证。
4. 真实 SearchPro 测试只覆盖 4 个 Query，不是全量回归。
5. MCP CSV 工具返回内容，不直接生成服务器磁盘文件；这是 MCP 传输兼容设计，不是下载 URL。

## 复现命令

```powershell
# 0. 真实 SearchPro（必须显式确认成本）
$env:GEO_RADAR_URL="http://127.0.0.1:3000"
$env:GEO_RADAR_TOKEN="gr_..."
$env:SEARCHPRO_BRAND_ID="cmvrogw69000bmrhmnt55fgem"
$env:CONFIRM_REAL_SEARCH="1"
npm run searchpro:smoke:real

# 1. 全量回归
npm run typecheck
npm run lint
npm test
npm run build

# 2. MCP smoke
$env:GEO_RADAR_URL="http://127.0.0.1:3000"
$env:GEO_RADAR_TOKEN="gr_..."
npm run smoke:mcp

# 3. Skill 连接
node skills/geo-radar/scripts/check-connection.mjs

# 4. DSH MCP 模式
node scripts/install-dsh-plugin.mjs
dsh plugin --profile desktop add "$PWD/packages/dsh-geo-radar"

# 5. DSH Native 模式
node scripts/install-dsh-native.mjs
dsh plugin --profile desktop add "$PWD/packages/geo-radar-dsh"
```
