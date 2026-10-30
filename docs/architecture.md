# GEO Radar — 架构说明

## 1. 系统概览

GEO Radar 是一个围绕「问题管理 → 真实搜索 → 证据沉淀 → 品牌分析 → 优化执行 → 复测对比」运转的 GEO（生成式引擎优化）工作台。前端 Next.js App Router（React Server Components 优先），后端为同一进程内的 Route Handlers + 服务层，数据库 PostgreSQL + Prisma。

```
浏览器（React Client Components）
  │  fetch（仅同源 API）
  ▼
Next.js Route Handlers（src/app/api/**）— 输入校验(Zod)、权限、统一错误包
  ▼
服务层（src/server/services/**）— 业务规则、指标计算、规则引擎、搜索执行
  ▼
数据访问（Prisma, src/server/db）           外部（服务端 only）
                                            ├─ 元宝搜索 SearchPro（Bearer API Key）
                                            └─ 无其他第三方依赖
```

## 2. 目录职责

- `src/app/(auth)`、`src/app/(dashboard)`、`src/app/dashboard-tv`：页面层。Server Components 负责取数与权限跳转；交互集中在对应的 `components/**` 客户端组件。
- `src/app/api/**`：Route Handlers。统一使用 `withAuth`（会话 + 工作空间解析）、`parseBody`（Zod）、`handleApiError`（统一错误包）、`rateLimit`（内存限流，单实例语义）、`writeAuditLog`。
- `src/lib/providers/**`：搜索供应商抽象。`types.ts` 定义统一请求/响应/结果结构；`yuanbao/` 真实元宝适配器（schema/mapper/provider）；`mock/` 演示适配器；`registry.ts` 按工作空间凭据构建实例。
- `src/lib/model-providers/**`：大模型抽象。`types.ts`（ModelAdapter/ModelError 分类）；`openai-compatible.ts`（Chat Completions 适配器：超时/错误分类/取消轮询/用量透传）；`registry.ts` 按工作空间 ModelProviderCredential 构建并解密。
- `src/server/services/conversation/**`：对话平台。
  - `context-builder.ts`（纯函数）：URL 规范化去重、带编号来源上下文、引用校验（移除伪造 [n]）、多轮历史裁剪。
  - `search-runner.ts`：对话搜索执行器——复用元宝 Provider，结果落为 SearchTask(source=CHAT) + SearchResult（questionId 空）+ Evidence，原始响应快照照常保存。
  - `orchestrator.ts`：三模式分派（SEARCH_ANSWER / SEARCH_EVIDENCE / GEO_ANALYSIS），Run 状态机 QUEUED→SEARCHING→GENERATING→COMPLETED/FAILED/CANCELLED，阶段实时落库供前端轮询；模型未配置时知情降级，不伪造回答。
- `src/server/services/**`：
  - `search-execution.ts`：任务创建/启动/取消/重试、并发 worker、退避重试、页面级证据归档、采集快照触发。
  - `url-normalization`（`src/lib/url-normalization.ts`）：URL 规范化与页面键。
  - `page-classification.ts`：可解释页面类型识别。
  - `brand-matching.ts`：品牌/竞品匹配依据、页面级分析（evidence-v3）。
  - `question-set-service.ts`：问题集版本快照、版本发布、复制、归档。
  - `matrix-service.ts`：品牌问题矩阵、服务端统一指标（geo-metrics-v2）。
  - `snapshot-service.ts`：COLLECTION / RECOMPUTE 快照、重新分析。
  - `retest-service.ts`：手动复测任务与复测链。
  - `comparison-service.ts`：两轮比较、共同子集、页面变化、波动观测区间。
  - `collection-report-service.ts`：证据中心报告、规则建议、Markdown/HTML/CSV 渲染。
  - `schedule-service.ts` + `src/lib/schedule-time.ts`：定时排期、时区计算、并发/成本守卫、tick。
  - `metrics.ts`：原有 overview 指标（品牌出现率/问题覆盖率/官网来源覆盖率/趋势/来源域名/竞品）。
  - `mention-detection.ts`：可解释的品牌/竞品规则识别（词边界 + 域名同站判定 + 低置信降级）。
  - `domain-normalization.ts`：registrable domain、同站判定（实现位于 `src/lib/domain-utils.ts`）。
  - `provider-credential-service.ts`：密钥加密存储、脱敏读取、真实连接测试。
  - `recommendations.ts` / `experiments.ts`：规则建议引擎、任务对比。
- `scripts/scheduler.mjs`：独立调度进程，定时调用 `/api/schedules/tick`。
- `src/server/security/**`：AES-256-GCM 凭据加密（`crypto.ts`）、日志脱敏（`logger.ts`）。
- `tests/`：Vitest 单元/集成测试 + Playwright E2E。

## 3. 数据模型（prisma/schema.prisma）

核心链路：`Workspace → Brand/Competitor/QuestionSet/Question`；`QuestionSetVersion` 冻结问题集内容；`SearchTask → SearchTaskItem → SearchResult → Evidence → EvidenceReview`；`RawSearchResponse` 保存原始响应快照；`AnalysisSnapshot` 保存每轮分析结果；`Report` 保存报告快照；`Schedule/ScheduleRun` 保存定时执行；`OptimizationEvent` 记录优化事件。

隔离原则：所有业务表带 `workspaceId`；服务层/API 层按当前会话解析工作空间，不接受前端传入的裸 `workspaceId` 作为授权依据。级联删除策略见 schema：任务/结果/证据随工作空间级联；品牌删除时任务 `SetNull` 保留历史；问题删除时历史任务 `questionId` 置空；问题集删除改为归档，避免破坏历史。

原始/分析分层：`SearchResult` 与 `RawSearchResponse` 是采集事实；`Evidence` 是可重算的分析层。重新分析只更新 Evidence 并生成新快照，不触碰原始结果。

## 4. 搜索任务执行流程

1. 用户在搜索实验室创建任务（QUEUED）——校验问题集版本并冻结问题文本，无外部请求。
2. 用户确认后 `POST /start`：服务端再次执行真实模式守卫（凭据 CONNECTED + 全局开关 + 未禁用 + 加密密钥可用），置 RUNNING，启动执行器。
3. 执行器以受限并发（默认 2）逐项调用 Provider；每项完成后即时持久化 item 状态/结果/页面级证据/原始响应，前端 3 秒轮询任务详情。
4. 取消：RUNNING 任务置 `cancelRequested`，worker 在下一项前读取并停止，剩余项置 CANCELLED。
5. 收尾：按成功/失败/取消/空结果/解析异常计算 COMPLETED / PARTIAL_FAILED / FAILED / CANCELLED，并写入 `failureReason`；有成功项时自动创建 COLLECTION 快照。
6. 复测：`POST /api/search-tasks/[id]/retest` 创建新任务，关联 `baselineTaskId`，不复用上一轮结果。
7. 定时：外部 cron / `scripts/scheduler.mjs` 调用 `/api/schedules/tick`，按排期创建新任务；`ScheduleRun(scheduleId, plannedAt)` 唯一防重复。

**执行宿主限制**：执行器运行在 Next.js 服务进程内（Node long-running server 下可靠）。若部署到 serverless 或多实例环境，应将执行器迁移为独立后台工作进程（消费队列），接口契约不变。此为当前已知部署约束，已在部署文档标注。

## 5. 指标口径

### 5.1 搜索任务 / 证据链（`matrix-service.ts`，`geo-metrics-v2`）

- **分母**：有效问题 = 执行成功且至少返回 1 条结果的问题；失败、取消、空结果、未执行不计入分母。
- **品牌提及问题率**：有效问题中至少一条证据被规则识别或人工确认为本品牌的问题数 ÷ 有效问题数；同一问题多个结果只计一次；待复核不计入分子。
- **官网结果覆盖率**：有效问题中至少一个页面属于品牌官网（主域/官方子域）的问题数 ÷ 有效问题数。品牌未配置官网域名/官方子域时，指标为 `notConfigured`，显示「不可计算/未配置」，不是 0%。
- **第三方页面覆盖率**：有效问题中至少一个非官网页面提及品牌的问题数 ÷ 有效问题数。
- **页面类型分布**：品牌相关证据按规范化 URL 去重后的页面类型数量/占比。
- **问题类别覆盖**：按任务创建时的问题类别快照分组，品牌被发现的问题比例。
- 每个指标返回分子、分母、公式版本、定义、样本范围、`smallSample`（< 5）提示。
- 失败与空结果单独展示，绝不当作「品牌未出现」。

### 5.2 原有 overview 指标（`metrics.ts`）

- 有效已完成问题 = 真实模式（executionMode=REAL 且 isMock=false 且 source=LAB）、item 状态 SUCCESS 的问题，按 `questionId` 去重取最近一次成功执行；对话平台（source=CHAT）不进入。
- 品牌出现率、问题覆盖率、官网来源覆盖率口径与页面「口径」提示一致；失败/取消/未执行不计入分母；模拟任务不进入统计。

## 6. 真实数据与模拟数据隔离

- `SearchTask.executionMode`（REAL/MOCK）+ `SearchResult.isMock` + `Evidence.isMock` 三层标记。
- Mock Provider 不发起外部请求；Mock 连接测试永远不会改变真实凭据状态。
- 所有统计查询显式过滤 `executionMode: "REAL"` / `isMock: false`。
- UI 中模拟数据展示「模拟数据」徽章。

## 7. 权限模型

- 会话：随机 32 字节 token，DB 存 SHA-256（混入 AUTH_SECRET），httpOnly Cookie，30 天。
- 工作空间：注册自动创建个人空间（OWNER）；`getActiveWorkspaceId` 只返回当前用户有成员关系的空间；切换空间服务端校验成员资格。
- 所有 API：未登录 401；无工作空间 403；跨空间资源访问 404（不泄露存在性）。

## 8. 安全要点

- API Key：AES-256-GCM（独立环境密钥）；保存后不可回读；日志经 `redact`（注册密钥值 + Bearer 兜底）；审计日志仅存掩码。
- 密码：bcrypt（cost 12）。
- 限流：登录/注册/连接测试端点内存限流。
- 外链一律 `rel="noopener noreferrer nofollow"`；系统不抓取用户提供或供应商返回的 URL（无 SSRF 面）。
- 安全响应头：nosniff / DENY frame / Referrer-Policy。

## 9. 定时采集架构与可靠性边界

- 排期数据：`Schedule`（频率/时区/星期/成本确认/下次执行/最近状态）+ `ScheduleRun`（计划时间/状态/错误分类/关联任务）。
- 调度入口：`POST /api/schedules/tick`。配置 `CRON_SECRET` 时必须提供 `x-cron-secret`，处理所有工作空间；未配置时仅允许登录用户触发当前工作空间。
- 单机调度：`npm run scheduler`（`scripts/scheduler.mjs`）作为独立 Node 进程定时调用 tick，不依赖浏览器页面。
- 并发：`SCHEDULE_MAX_CONCURRENT` 限制全局运行中任务数；同一排期已有 RUNNING 任务时跳过本次。
- 幂等：`ScheduleRun(scheduleId, plannedAt)` 唯一；重复 tick 安全跳过。
- 成本：真实排期创建时必须 `confirmedCost=true`；每次执行前再次检查数据源守卫。
- 失败：鉴权/未配置/限流/超时/任务失败分别记录状态与错误分类；不使用虚构数据填补。
- 限制：任务执行仍在 Web 进程内，进程重启会中断；多实例部署应只运行一个调度入口，或改用平台 cron，并考虑将执行器迁移到独立 worker。
