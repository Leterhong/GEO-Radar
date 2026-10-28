# Agent 集成：Skill / MCP / DSH 插件

GEO Radar 可以作为一个 **Agent 可调用的证据平台**，而不只是网页应用。

仓库内置：

```text
skills/geo-radar/SKILL.md          Agent Skill（工作流与安全规则）
packages/geo-radar-mcp/            MCP Server（12 个 geo_* 工具）
packages/dsh-geo-radar/            DSH 插件（纯声明，挂载 MCP）
```

---

## 先回答一个常见问题：MCP 需要服务器吗？

不一定。

| 形态 | 需要托管？ | 适用 |
| --- | --- | --- |
| **本地 stdio MCP** | 不需要 | Claude Code / Cursor / DSH 在本机启动 `node packages/geo-radar-mcp/index.mjs` |
| **远程 HTTP MCP** | 需要 | 多用户 SaaS、团队共享；需要部署一个可访问的 MCP 服务并做鉴权 |

**把 MCP 代码放到 GitHub，不等于其他人打开网页就能直接调用。** 其他人需要：

1. clone 仓库；
2. `npm ci`；
3. 创建 workspace Token；
4. 在自己的 MCP 客户端里配置 `command + args + env`。

这是目前开源 MCP 最常见、也最安全的分发方式。远程 MCP 是后续部署形态，不是 GitHub 仓库自动提供的能力。

---

## 1. 创建 Workspace API Token

Token 是 workspace 级凭证，明文只显示一次，服务端只存 SHA-256 哈希。

### 方式 A：CLI

```bash
npm run token:create -- you@example.com "MCP token"
```

输出：

```text
GEO Radar API Token created
  workspace: My workspace (cm...)
  prefix:    gr_abcd1234
  token:     gr_...
```

保存：

```bash
export GEO_RADAR_URL=http://127.0.0.1:3000
export GEO_RADAR_TOKEN=gr_...
```

### 方式 B：网页

1. 登录 GEO Radar；
2. 设置 → **API Token / MCP**；
3. 创建 Token；
4. 立即复制（只显示一次）。

Token 管理 API：

```text
GET    /api/tokens
POST   /api/tokens        { "name": "...", "expiresInDays": 30 }
DELETE /api/tokens/:id
```

> Token 管理必须使用浏览器登录会话；API Token 不能给自己再创建 Token。

---

## 2. MCP Server

位置：

```text
packages/geo-radar-mcp/index.mjs
```

依赖已包含在根 `package.json`（`@modelcontextprotocol/sdk`）。clone 后 `npm ci` 即可运行。

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

### 验证

```bash
GEO_RADAR_URL=http://127.0.0.1:3000 \
GEO_RADAR_TOKEN=gr_... \
npm run smoke:mcp
```

输出应包含：

```text
TOOLS 12
BRANDS ...
MCP SMOKE PASSED
```

### 工具

| 工具 | 作用 |
| --- | --- |
| `geo_list_brands` | 找 brandId |
| `geo_list_question_sets` | 找固定问题集/版本 |
| `geo_list_tasks` | 找基线/复测任务 |
| `geo_get_task` | 每问状态、结果数、耗时、RequestId |
| `geo_wait_for_task` | 轮询运行中的任务 |
| `geo_get_matrix` | 品牌 × 竞品矩阵；默认省略 evidence 数组 |
| `geo_get_evidence` | 单条页面级证据、原始元数据、复核历史 |
| `geo_compare_rounds` | 两轮比较、页面增减、数据质量、波动 |
| `geo_create_task` | 创建 QUEUED 任务（不调用搜索） |
| `geo_start_task` | 启动任务；REAL 必须 `confirmReal=true` |
| `geo_create_report` | 生成冻结报告 |
| `geo_get_report` | 读取报告 |

### 安全边界

- MCP 不生成搜索结果或指标，全部来自 GEO Radar API。
- `geo_create_task` 只创建任务，不调用元宝搜索。
- `geo_start_task` 对 `REAL` 任务要求 `confirmReal=true`，避免 Agent 自行消耗额度。
- 测试流程优先 `MOCK`。
- 失败、空结果、未发现、待复核是不同状态。

---

## 3. Agent Skill

位置：

```text
skills/geo-radar/SKILL.md
```

Skill 告诉 Agent：

- 什么时候使用 GEO Radar；
- 先 `geo_list_brands` / `geo_list_question_sets`；
- 如何安全地创建/启动任务；
- 如何引用证据 URL 与 RequestId；
- 不能把两轮波动说成因果；
- 不能伪造指标。

支持 Agent Skills 的客户端可以直接把 `skills/geo-radar` 放入 skills 目录；不支持 Skill 的客户端可以只接 MCP。

---

## 4. DSH 插件

DSH 插件是“纯声明”形态：它把 `@deepseek-ai/dsh-mcp-client` 一行插入 profile，不包含 UI 代码。

### 安装

```bash
export GEO_RADAR_URL=http://127.0.0.1:3000
export GEO_RADAR_TOKEN=gr_...

node scripts/install-dsh-plugin.mjs
dsh plugin --profile web add "$PWD/packages/dsh-geo-radar"
```

Windows PowerShell：

```powershell
$env:GEO_RADAR_URL = "http://127.0.0.1:3000"
$env:GEO_RADAR_TOKEN = "gr_..."
node scripts/install-dsh-plugin.mjs
dsh plugin --profile web add "$PWD\packages\dsh-geo-radar"
```

### 重启

`dsh.profile.bundles` 只在 boot 时读取。安装后必须重启 DSH。

### 验证

会话里应该出现：

```text
mcp__geo-radar__geo_list_brands
mcp__geo-radar__geo_get_matrix
mcp__geo-radar__geo_compare_rounds
...
```

### 生成的补丁

`scripts/install-dsh-plugin.mjs` 生成：

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

该文件包含 Token，已加入 `.gitignore`。

### 卸载

```bash
dsh plugin --profile web remove @geo-radar/dsh-plugin
```

---

## 5. 远程 MCP（后续）

如果要做“别人打开网页就能用”，需要部署远程 MCP：

```text
GEO Radar Web + /api/mcp (Streamable HTTP)
   ↑ Authorization: Bearer gr_...
MCP 客户端（url + headers）
```

这需要：

- 一个公网可访问的部署；
- Token 鉴权；
- 速率限制；
- 多租户隔离。

当前仓库提供的是**本地 stdio MCP**；远程 HTTP MCP 是下一步，不应把 GitHub 仓库当成托管服务。

---

## 常见问题

**Q: MCP 放在 GitHub，别人能直接调用吗？**

不能直接“打开即用”。需要 clone/安装、创建 Token、在客户端配置命令。远程 MCP 才需要服务器。

**Q: 为什么不用邮箱密码？**

Token 可撤销、可限 workspace、可审计，不需要把用户密码交给 Agent。

**Q: MCP 会不会自动扣元宝搜索额度？**

`geo_create_task` 不调用搜索；只有 `geo_start_task` 会。REAL 任务需要显式 `confirmReal=true`。

**Q: 可以只做 Skill 不做 MCP 吗？**

可以。Skill 是说明书；MCP 是工具。两者独立，建议一起用。

**Q: 支持 DSH 之外的客户端吗？**

MCP 是通用协议。Claude Code、Cursor、其他支持 MCP 的客户端都可以接。
