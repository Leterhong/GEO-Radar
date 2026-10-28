# GEO Radar — 元宝搜索接入说明

> 接入方式：腾讯云元宝搜索「服务 API Key 方式」（非腾讯云标准签名方式）。
> 本文档说明 GEO Radar 中元宝搜索适配器的实现边界、配置方式、错误处理与安全约束。

## 1. 当前状态

- **真实 Provider 已实现**（`src/lib/providers/yuanbao/yuanbao-search.provider.ts`），按官方「服务 API Key 方式」调用。
- **尚未使用真实 API Key 验证线上连通性**：本文撰写时未提供生产密钥，所有验证基于 Mock（单元测试覆盖官方文档中的协议与错误形态）。首次拿到真实 Key 后，请在设置页完成一次「测试连接」并核对 RequestId / Version / Pages 结构。
- Mock 模式（`src/lib/providers/mock/`）仅用于开发与演示，结果带「模拟数据」标记，不进入真实统计。

## 2. 协议要点（依据官方文档）

| 项目 | 值 |
| --- | --- |
| 请求方法 | POST |
| 请求地址 | `https://api.wsa.cloud.tencent.com/SearchPro` |
| 认证 | `Authorization: Bearer <API_KEY>` |
| Content-Type | `application/json; charset=UTF-8` |
| 必填参数 | `Query`（搜索关键词） |

**不要**将本协议与腾讯云标准签名方式（`wsa.tencentcloudapi.com`、`X-TC-Action`、`Version`、TC3-HMAC-SHA256 签名）混用。GEO Radar 未实现标准签名方式。

### 2.1 可选参数与版本能力（官方文档 product/1806/121811）

| 参数 | 类型 | 取值 | 版本限制 |
| --- | --- | --- | --- |
| `Mode` | Integer | 0=公开网页信源；1=优质权威垂直信源；2=混合 | 极速版不支持 |
| `Site` | String | 单域名搜索（如 `qq.com`）或排除（`exclude:a.com\|b.com`，最多 5 个） | 与 Mode 共用时仅对公开网页信源生效 |
| `Cnt` | Integer | 10/20/30/40/50 | 极速版不支持 |
| `Industry` | String | `gov` / `news` / `acad` / `finance` | 极速版不支持 |
| `Freshness` | String | `d1-d30` / `m1-m12` / `y1-y5` / `yyyy-mm-dd` / `yyyy-mm-dd,yyyy-mm-dd`（区间 B 不得晚于 A） | 五种形态不可混合 |
| `Deeplinks` | Boolean | 是否返回子链 | 仅旗舰版支持 |

GEO Radar 的处理原则：

- **没有必要的参数不发送**（`buildYuanbaoRequestBody` 只序列化用户显式提供的参数）。
- 所有参数经 Zod 校验（`yuanbao-search.schema.ts`）：域名格式、Freshness 形态、Cnt 枚举、Query 长度。
- **不假设用户套餐版本**：可选参数由用户自行选择；响应中的 `Response.Version`（lite/standard/flagship）会保存到任务与原始响应，极速版不支持的字段不会返回，GEO Radar 也不会伪造。
- 搜索实验室中的地区 / 语言等内部字段：官方服务 API Key 方式不支持对应参数，**不会**加入请求体；该信息仅保存在问题档案中，并在 UI 中注明当前不能由供应商接口直接控制。

## 2.2 响应结构

```jsonc
{
  "Response": {
    "Query": "原始查询语",
    "Pages": ["<JSON 字符串 1>", "<JSON 字符串 2>", "..."],
    "RequestId": "服务端请求 ID",
    "Version": "lite | standard | flagship",
    "Msg": "提示信息（如 hit black query）"
  }
}
```

`Pages` 的每个元素本身可能是 JSON 字符串，也可能（防御性兼容）已是对象。GEO Radar 的解析规则（`yuanbao-search.mapper.ts`）：

1. **逐条独立解析**：单条解析失败只记录该条错误（`pageParseErrors`，含索引与原因），不影响其余有效结果。
2. 每条经 Zod 结构校验（`yuanbaoPageSchema`），**缺少 `url` 的条目视为解析失败**（无法作为可追溯证据）。
3. 字段映射（仅保存真实返回的字段，缺失即为空）：

| 官方字段 | 统一结果字段 | 说明 |
| --- | --- | --- |
| `title` | `title` | 结果标题 |
| `url` | `url` / `domain`（解析） | 来源 URL / 域名 |
| `date` | `publishedAt` | 发布时间（原始字符串） |
| `passage` | `snippet` | 标准摘要 |
| `content` | `fullContent`（extra） | 动态摘要（极速版不返回） |
| `site` | `siteName`（extra） | 网站名称，可能为空 |
| `score` | `score`（extra） | 相关性 0~1，仅真实返回时保存 |
| `authority_level` | `authorityLevel`（extra） | 权威度 0~5，仅旗舰版返回 |
| `pics` | `pics`（extra） | 图片（caption/origin_url），极速版不返回 |
| `favicon` | `favicon`（extra） | 网站图标，可能为空 |
| `deeplinks` | `deeplinks`（extra） | 子链（title/url），仅旗舰版 |

4. **原始响应快照**保存到 `RawSearchResponse` 表（上限 256KB，超出截断并标记），用于追溯与重新解析。
5. `Msg` 非空（如 `hit black query`）时记录到任务与结果元数据；`Pages` 为空且 `Msg` 非空视为「成功但无结果」，不会计为品牌未出现。

## 2.3 错误处理与重试

统一错误分类（`src/lib/providers/errors.ts`）：

| 供应商错误码 | 分类 | 用户提示方向 | 可重试 |
| --- | --- | --- | --- |
| `UnauthorizedOperation` | 认证或授权失败 | 检查 API Key 是否正确 | 否 |
| `InvalidParameter` | 参数错误 | 检查参数与套餐支持范围 | 否 |
| `RequestLimitExceeded` | 触发频率限制 | 自动退避重试或稍后再试 | 是 |
| `ResourceNotFound` | 服务未开通 | 先到腾讯云控制台开通服务 | 否* |
| `ResourceUnavailable` | 资源不可用 | 检查欠费/服务状态 | 是（视为暂时性） |
| `InternalError` | 供应商内部错误 | 自动重试，持续失败再联系 | 是 |
| HTTP 401/403（无业务码） | 认证失败 | — | 否 |
| HTTP 429 | 限流 | — | 是 |
| HTTP 5xx | 供应商内部错误 | — | 是 |
| 网络错误 / 超时 | 传输层 | 检查服务器网络 | 是 |
| 无效 JSON | 响应损坏 | 安全失败 | 是（计入重试上限） |
| 缺少必要响应字段（Pages） | 结构异常 | 安全失败，不写入结果 | 否 |
| Pages 单条解析失败 | 局部 | 其余结果照常保存 | 不适用 |

重试策略：可重试错误最多额外重试 2 次（退避 1s / 3s，有上限）；每次尝试单独计入 `attempts` 并可区分 RequestId（`<uuid>#<attempt>`），**不会隐藏额外调用**。认证与参数错误绝不重试。

## 3. 配置方式

1. 在腾讯云元宝搜索控制台创建**服务 API Key**（每账号最多 3 个；Key 仅创建时可见）。
2. GEO Radar →「设置 → 元宝搜索数据源」粘贴 Key 并**保存**（服务端 AES-256-GCM 加密落库；需要已配置 `CREDENTIAL_ENCRYPTION_KEY`，否则拒绝保存、不会降级为明文）。
3. 点击**测试连接**：服务端使用已保存密钥发起一次真实最小请求（仅 `Query`，兼容所有版本）；只有真实成功才标记「已连接」。页面会展示测试时间、耗时、RequestId、版本与脱敏结果摘要。
4. 连接测试会产生真实计费调用，UI 已明确提示。

相关环境变量（`.env.example`）：

```dotenv
YUANBAO_SEARCH_ENABLED=false   # 全局开关：true 才允许真实调用
# YUANBAO_SEARCH_ENDPOINT=     # 默认官方地址；仅测试环境允许覆盖指向 Mock Server
CREDENTIAL_ENCRYPTION_KEY=     # AES-256-GCM 密钥（32 字节 hex/base64），独立于被加密数据
```

生产环境安全要求：

- `YUANBAO_SEARCH_ENDPOINT` 覆盖仅限测试环境；Provider 会检测非官方域名并在 `validateConfig` 中警告。
- 测试/演示环境禁止使用生产 Key（环境隔离 + 全局开关双重控制）。
- API Key 不写入 `NEXT_PUBLIC_*`、日志、URL、错误响应；前端只收到 `maskedKey`（如 `abcd••••••••wxyz`）与状态。
- 支持替换（保存新 Key）、禁用（阻止新真实任务）、清除（回到未配置）。

## 4. 搜索执行与成本控制

- 任务创建（`POST /api/search-tasks`）不发起任何请求；执行必须经 `POST /api/search-tasks/[taskId]/start`，且前端在执行前展示：问题数量、预计请求数、当前数据源与配置状态、是否产生真实调用，并要求用户确认。
- 页面加载、切换标签、刷新大屏/仪表盘都不会触发搜索；大屏自动刷新只重新读取已保存数据（默认关闭）。
- 执行并发受 `SEARCH_CONCURRENCY`（1-5，默认 2）限制；单请求超时 `SEARCH_TIMEOUT_MS`（默认 30s）。
- 失败项可由用户主动重试；重试同样通过守卫并单独记录 attempts。
- 只有真实发生的供应商请求计入调用统计（`SearchTaskItem.attempts`、审计日志）；Mock 任务完全不产生调用。

## 5. 测试

- 单元测试（Vitest）覆盖官方协议的 15 个场景：正常请求、Key 缺失、认证失败、参数错误、限流、未开通、超时、网络异常、无效 JSON、单条 Pages 解析失败、可选字段缺失、RequestId 保留、密钥不出现在日志/前端、未确认不发起请求（守卫）、禁用数据源阻止任务。见 `tests/yuanbao-provider.test.ts`、`tests/unit-core.test.ts`。
- 所有测试使用注入的 `fetchImpl`（或守卫函数），**不会**发起真实请求、不消耗真实额度。
- 运行：`npm test`。

## 6. 待真实环境验证事项（明确列出）

1. 真实 API Key 下的端到端连通性（测试连接 → 任务执行 → 结果入库）。
2. 真实响应中 `Pages` 元素的字段形态与文档的一致性（尤其 `content`、`pics`、`authority_level`、`deeplinks` 的实际出现条件）。
3. 用户的实际套餐版本（lite/standard/flagship）对可选参数的支持情况。
4. 限流阈值与退避参数在生产负载下的表现。
5. `hit black query` 等风控 Msg 的完整取值集合。
