# 证据链、品牌问题矩阵、复测与可信报告

本文档记录 2026-10-28 版本的核心能力升级：从「数据展示」升级为「以真实搜索证据为基础、指标可复算、历史可比较、结论不过度承诺」的 GEO 监测平台。

## 1. 数据分层

| 层 | 表 | 说明 |
| --- | --- | --- |
| 采集事实 | `SearchTask` / `SearchTaskItem` | 一轮任务、每个问题的执行状态、失败分类、尝试次数、空结果/解析异常计数；创建时冻结问题集版本与问题文本 |
| 原始结果 | `SearchResult`、`RawSearchResponse` | 接口返回的标题/URL/摘要/元数据，以及原始响应体与请求元数据；分析不覆盖 |
| 分析证据 | `Evidence` | 规范化 URL、页面类型、来源角色、品牌匹配依据、规则版本、人工复核状态 |
| 人工复核 | `EvidenceReview` | 每次复核的操作人、时间、前后值、备注 |
| 历史快照 | `AnalysisSnapshot` | COLLECTION（采集完成时）与 RECOMPUTE（新规则重算）并列保存，不可变 |
| 报告 | `Report` | 快照式报告；`kind` 区分分析报告/搜索证据报告/两轮对比报告 |
| 问题集版本 | `QuestionSetVersion` | 问题集内容的不可变快照，历史任务引用 |
| 定时采集 | `Schedule` / `ScheduleRun` | 排期、幂等执行记录、失败状态与关联任务 |
| 优化事件 | `OptimizationEvent` | 内容/页面修改记录；只用于时间关联，不推断因果 |

关键约束：

- `Evidence.url` 永远保留原始值；`normalizedUrl` 仅用于比较/去重。
- 历史任务的 `SearchTaskItem.questionText` 与 `questionSetVersionId` 冻结；编辑当前问题不会改变历史任务。
- 删除问题或问题集不会级联删除历史任务/证据（问题删除后 `questionId` 置空；问题集删除改为归档）。
- `AnalysisSnapshot(taskId, kind, ruleVersion)` 唯一；重算不会覆盖同一规则版本的采集快照。

## 2. URL 规范化

实现：`src/lib/url-normalization.ts`（`URL_NORMALIZATION_VERSION = url-norm-v1`）。

- 协议/主机名小写、补全 https、移除默认端口；
- 移除普通锚点，保留 `#/`、`#!/` 路由型 fragment；
- 去除非根路径尾部斜杠；
- 只移除已知跟踪参数（`utm_*`、`gclid`、`fbclid`、`spm`、`share_*` 等），保留 `id`、`q`、`page`、`lang`、`source` 等可能决定内容的参数；
- 参数按键/值稳定排序；统一百分号转义；
- 非法 URL 返回 `valid=false`，不做猜测；`pageKeyOf` 回退到原始 URL，不跨页面合并。

## 3. 页面类型分类

实现：`src/lib/page-classification.ts`，规则 ID 与中文原因写入 `Evidence.pageTypeRule`。

顺序：官网判定（主域 + 官方子域）→ 官网路径细分 → 第三方已知站点 → 第三方路径/标题线索 → OTHER / UNKNOWN。

- 官网首页、产品页、文档/帮助、博客/资讯、第三方媒体、电商、社区/论坛、其他、未知。
- 无法可靠识别时返回 `OTHER`（有效 URL，低置信）或 `UNKNOWN`（无效 URL），不为了提高覆盖率强行归类。
- 页面类型可人工修正（`pageTypeSource=MANUAL`）。

## 4. 品牌匹配

实现：`src/server/services/brand-matching.ts`（`EVIDENCE_RULE_VERSION = evidence-v3`）。

品牌配置：正式名称、别名、官网域名、官方子域名、产品名称、产品别名。

匹配依据（落库为 `brandMatchBasis`）：

- `OFFICIAL_DOMAIN`：官网域名/官方子域同站匹配；
- `TITLE_NAME` / `TITLE_ALIAS` / `TITLE_PRODUCT_NAME` / `TITLE_PRODUCT_ALIAS`；
- `SNIPPET_NAME` / `SNIPPET_ALIAS` / `SNIPPET_PRODUCT_NAME` / `SNIPPET_PRODUCT_ALIAS`；
- `LOW_CONFIDENCE_ALIAS`：≤3 字符拉丁别名，进入待复核；
- `COMPETITOR_ONLY`、`NONE`；
- 早期数据无依据时使用 `LEGACY_MATCH`，建议重算。

状态：官网页面或高置信文本匹配 → `CONFIRMED_BRAND`；低置信/空文本 → `PENDING_REVIEW`；仅竞品 → `CONFIRMED_COMPETITOR`；无命中 → `IRRELEVANT`。

**不推断「是否被最终生成式回答引用」**：该信息无法从普通搜索结果得到，页面与报告明确说明。

## 5. 品牌问题矩阵

实现：`src/server/services/matrix-service.ts`；页面 `/matrix`；接口 `GET /api/matrix`。

单元格状态：

| 状态 | 含义 |
| --- | --- |
| `FOUND` | 有效结果中存在该实体的确认证据（官网或匹配） |
| `NOT_FOUND` | 本次有效结果未发现；可下钻查看原始结果 |
| `TASK_FAILED` | 问题执行失败；不当作未发现 |
| `EMPTY` | 执行成功但返回 0 条结果 |
| `NOT_COLLECTED` | 尚未采集 |
| `NEEDS_REVIEW` | 存在待复核证据，尚未确认 |

页面支持：品牌/轮次选择、包含模拟任务、按类别分组、按状态/类别筛选、指标口径弹窗、证据下钻、页面类型分布、类别覆盖、限制说明。

## 6. 指标口径（服务端统一）

实现：`metricsVersion = geo-metrics-v2`。

- **有效问题（分母）** = 执行成功且至少返回 1 条结果的问题；失败、取消、空结果、未执行不计入分母。
- **品牌提及问题率** = 有效问题中至少一条证据被规则识别或人工确认为本品牌的问题数 ÷ 有效问题数。同一问题多个结果只计一次；待复核不计入分子。
- **官网结果覆盖率** = 有效问题中至少一个页面属于品牌官网（主域/官方子域）的问题数 ÷ 有效问题数。
- **第三方页面覆盖率** = 有效问题中至少一个非官网页面提及品牌的问题数 ÷ 有效问题数。
- **页面类型分布** = 品牌相关证据按规范化 URL 去重后的页面类型数量/占比。
- **问题类别覆盖** = 按任务创建时的问题类别快照分组，统计品牌被发现的问题比例。
- 每个指标返回分子、分母、公式版本、定义、样本范围、样本量提示（`smallSample` < 5）。
- 指标只反映本轮搜索网页结果，不代表所有 AI 平台综合可见性，也不等于生成式回答引用。

## 7. 快照、复测与比较

- 任务完成（有成功项）自动创建 `COLLECTION` 快照；也可在任务详情/历史快照页补建。
- 「用当前规则重算」：重新分析证据（保留人工复核字段），生成 `RECOMPUTE` 快照；原始结果不动。
- 复测：`POST /api/search-tasks/[taskId]/retest`，继承问题集版本/采集参数与品牌，创建全新 QUEUED 任务，`baselineTaskId` 关联上一轮；不复用结果。
- 比较：`GET /api/comparisons?baseline=&retest=`；页面 `/compare`。
  - **默认读取两轮采集时保存的 COLLECTION 快照**（指标、矩阵、证据摘要），避免后续人工复核/规则变更悄悄改写历史比较；缺少快照时才回退到当前证据实时计算，并在页面/报告标注数据来源。
  - 条件检查：品牌、数据源、执行模式、问题集版本、采集参数、匹配配置、分析规则版本；
  - 总体指标（各自分母）+ 共同可比问题子集指标（相同分母）；
  - 问题级提升/下降/持平/新增待复核/无法比较；
  - 页面新增/未再出现/持续出现（品牌相关页面，规范化 URL 去重）；
  - 一致性、缺失率、失败占比、空结果占比、待复核证据；
  - 波动：同品牌同问题集版本最近轮次的观测最小值/最大值/均值/极差，明确不是置信区间，并提示时间相关性。
- 优化事件：`/api/optimization-events`，可在比较页记录；报告注明前后相关不等于因果。

## 8. 可信报告

实现：`src/server/services/collection-report-service.ts`；页面 `/reports/[reportId]`；接口 `POST /api/reports` 支持 `taskId` / `compareTaskId`。

报告 14 节：基本信息、品牌竞品、时间范围、问题集版本、成功率与样本、指标与口径、问题矩阵、官网覆盖、页面类型、代表证据、历史变化、波动与限制、规则建议、生成时间与数据版本。

- 规则建议根据真实证据生成（产品问题缺品牌、第三方页面持续提及、样本不足、待复核、轮次变化、复测不足等），每条附证据 ID/问题引用与注意事项。
- 不把「未发现」解释为「官网存在技术错误」；不承诺提升。
- 导出：Markdown、HTML、指标 CSV、问题 CSV、证据 CSV；报告快照不被后续数据改写。
- 模拟任务默认拒绝生成报告；仅测试环境设置 `ALLOW_MOCK_REPORTS=true` 可验证流程，报告明确标注模拟数据。

## 9. 定时采集

实现：`src/server/services/schedule-service.ts`、`src/lib/schedule-time.ts`、`src/app/api/schedules/*`、`scripts/scheduler.mjs`。

- 支持每日/每周、IANA 时区、暂停/恢复/取消、下次执行时间、最近执行状态、执行记录。
- 成本确认：真实模式创建排期必须确认；执行前再次检查数据源守卫。
- 并发限制：全局运行中任务上限 `SCHEDULE_MAX_CONCURRENT`；同一排期不重叠。
- 去重：`ScheduleRun(scheduleId, plannedAt)` 唯一；重复 tick 安全跳过。
- 频率/请求限制：`SCHEDULE_MAX_QUESTIONS`、`SCHEDULE_MAX_ACTIVE_PER_WORKSPACE`、`MAX_QUESTIONS_PER_TASK`。
- 超时：单请求超时 `SEARCH_TIMEOUT_MS`；单任务最长执行时间 `TASK_TIMEOUT_MS`（默认 30 分钟，超时停止派发新问题，已完成结果保留）。
- 防重复：60 秒内同名/同品牌/同问题集版本的重复任务提交会被拒绝；同一基线 60 秒内重复复测会被拒绝。
- 调度入口：
  - 外部 cron：`POST /api/schedules/tick`，带 `x-cron-secret: $CRON_SECRET`；
  - 单机：`npm run scheduler`（独立进程，默认每 60s 调用 tick）；
  - 浏览器关闭不影响；任务执行仍在 Web 进程内，进程重启会中断。
- 未配置 `CRON_SECRET` 时，tick 仅允许登录用户触发当前工作空间（开发/手动）。

## 10. API 一览（新增/修改）

```text
GET    /api/matrix?brandId=&taskId=&includeMock=
GET    /api/matrix?brandId=&list=true
POST   /api/search-tasks/[taskId]/retest
GET    /api/search-tasks/[taskId]/snapshots
POST   /api/search-tasks/[taskId]/snapshots   { kind: "COLLECTION" | "RECOMPUTE" }
GET    /api/comparisons?baseline=&retest=
GET    /api/reports
POST   /api/reports                           { taskId, compareTaskId?, title? } | { analysisTaskId, title? }
GET    /api/reports/[reportId]/export?format=md|html|csv|questions-csv|evidence-csv
GET    /api/question-sets                     （含 currentVersion/latestVersion/taskCount）
GET    /api/question-sets/[id]/versions
POST   /api/question-sets/[id]/copy
GET    /api/evidence/[id]                     （含复核历史与原始响应元数据）
PATCH  /api/evidence/[id]                     { reviewAction, pageType, brandId, tags, relevance, reviewNote }
GET    /api/schedules
POST   /api/schedules
PATCH  /api/schedules/[id]
DELETE /api/schedules/[id]
POST   /api/schedules/[id]/run
POST   /api/schedules/tick                    （x-cron-secret 或登录会话）
GET/POST /api/optimization-events
PATCH/DELETE /api/optimization-events/[id]
```

## 11. 验证结果（2026-10-28）

### 11.1 自动化测试

```text
npm test
Test Files  6 passed (6)
Tests       125 passed (125)
```

新增测试：

- `tests/evidence-chain.test.ts`（24 项）：URL 规范化、页面分类、品牌匹配依据、短别名复核、显式官方域名、时间计算；
- `tests/integration-evidence-flow.test.ts`（9 项）：品牌/问题集版本 → Mock 采集 → 证据 → 矩阵 → 未配置官网不可计算 → 失败不计为未发现 → 复测 → 比较 → 报告导出 → 定时执行 → 版本历史不被覆盖。

### 11.2 类型检查 / 构建

```text
npm run typecheck  → 通过
npm run lint       → 通过
npm run build      → 通过（Next.js 14.2.28，27 个页面）
```

### 11.3 端到端 API 冒烟

`node scripts/smoke.mjs`（原功能）：58 项检查全部通过。

`node scripts/smoke-evidence-chain.mjs`（本次新增）：全部通过，覆盖：
注册 → 品牌/竞品 → 问题集版本与复制 → Mock 采集 → 矩阵 → 证据详情 → 人工复核（匹配 + 页面类型 + 历史）→ RECOMPUTE 快照 → 复测 → 比较 → 优化事件 → 对比报告 → 5 种导出 → 排期创建/立即执行/暂停/恢复/tick/取消。

### 11.4 浏览器 UI 验证

`node scripts/ui-verify.mjs`（Playwright Chromium）：全部通过，无未捕获 JS 错误。截图：

- `docs/assets/verification/matrix.png`
- `docs/assets/verification/matrix-cell-dialog.png`
- `docs/assets/verification/evidence-detail.png`
- `docs/assets/verification/compare.png`
- `docs/assets/verification/report.png`
- `docs/assets/verification/schedules.png`
- `docs/assets/verification/snapshots.png`
- `docs/assets/verification/task-detail.png`
- `docs/assets/verification/questions.png`
- `docs/assets/verification/brands.png`

### 11.5 调度入口验证

- `CRON_SECRET` 已配置时，无 `x-cron-secret` 的 `POST /api/schedules/tick` 返回 `401 UNAUTHORIZED`；
- 带正确 `x-cron-secret` 返回 `200 { ok: true, dueCount: 0 }`（测试时无到期排期）；
- `node scripts/scheduler.mjs` 可启动并指向 `APP_URL`，不依赖浏览器；
- 未配置 `CRON_SECRET` 时，登录用户触发 tick 仅处理当前工作空间（证据链冒烟已覆盖）。

### 11.6 真实元宝 API 验证

2026-10-28 使用现有已连接凭据发起 **1 次受控单请求**（1 个问题，`maxResults=10`）：

- 任务状态 `COMPLETED`，成功 1 / 失败 0；
- 返回 10 条真实结果，全部 `isMock=false`；
- 证据均写入 `normalizedUrl`，`ruleVersion=evidence-v3`；
- 页面类型/来源角色/匹配依据/竞品匹配正常落库；
- 验证后已删除该临时任务与原始响应，不保留伪造或演示用真实数据。

未进行批量或持续真实调用测试；真实账号权限、计费与限流以官方控制台为准。

### 11.7 真实历史数据回归

对数据库中已有的真实任务（10 个问题、99 条证据）执行矩阵/快照/报告生成（不发起新搜索）：

- 有效问题 10；品牌提及问题率 60%（6/10）；官网覆盖率 0%（0/10）；第三方覆盖率 60%（6/10）；
- 页面类型：第三方媒体 9、其他 8、社区 1（去重后 18 页）；
- 报告 Markdown/HTML/CSV 生成成功，临时报告已删除。

## 12. 已知限制

1. 页面类型分类为启发式规则，长尾站点可能落入 OTHER/UNKNOWN；可人工修正。
2. 品牌文本匹配对多语言词边界、超短别名有天然限制；短别名进入待复核。
3. 不推断生成式回答引用；搜索网页证据与最终 AI 回答之间不能画等号。
4. 定时采集依赖外部调度器；任务执行仍在 Web 进程内，进程重启会中断。
5. 波动分析第一版不提供置信区间；重复采样可能存在时间相关性。
6. 早期数据（升级前）的匹配依据以 `LEGACY_MATCH` 标注，建议用当前规则重算生成新快照。
7. 报告 PDF 未实现；可导出 HTML 后打印。
