# GEO Radar — API 一览

所有接口返回统一包：成功 `{ ok: true, data }`；失败 `{ ok: false, error: { code, message, details? } }`。
认证基于 httpOnly 会话 Cookie；所有业务查询按当前工作空间隔离，不接受裸 workspaceId 授权。

## 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | 注册（限流）；自动创建个人工作空间 |
| POST | `/api/auth/login` | 登录（限流） |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/me` | 当前用户 |

## 工作空间

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/workspaces` | 列表 / 创建（创建者 OWNER） |
| POST | `/api/workspaces/active` | 切换当前工作空间（校验成员资格） |

## 品牌 / 竞品

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/brands` | 列表 / 创建 |
| GET/PATCH/DELETE | `/api/brands/[brandId]` | 详情 / 更新 / 删除 |
| GET/POST | `/api/competitors` | 列表 / 创建 |
| PATCH/DELETE | `/api/competitors/[competitorId]` | 更新 / 删除 |

## 问题

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/question-sets` | 列表（含 currentVersion/latestVersion/taskCount）/ 创建（初始化版本 1） |
| GET/PATCH/DELETE | `/api/question-sets/[questionSetId]` | 详情（含版本）/ 更新（自动发布新版本）/ 归档 |
| GET | `/api/question-sets/[questionSetId]/versions` | 不可变版本历史（含问题快照） |
| POST | `/api/question-sets/[questionSetId]/copy` | 复制问题集（新 ID、版本 1） |
| GET/POST | `/api/questions` | 列表（分页/筛选/类别）/ 创建（自动发布版本） |
| GET/PATCH/DELETE | `/api/questions/[questionId]` | 详情 / 更新 / 删除（历史任务文本保留） |
| POST | `/api/questions/import` | CSV/文本批量导入（支持类别列、错误行报告、自动发布版本）；GET 导出 CSV |

## 数据源（元宝搜索）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/settings/search-provider` | 脱敏配置（maskedKey/status/最近测试），永不返回完整 Key |
| PUT | `/api/settings/search-provider` | 保存 API Key（服务端 AES-256-GCM 加密；需 CREDENTIAL_ENCRYPTION_KEY） |
| DELETE | `/api/settings/search-provider` | 清除密钥 |
| POST | `/api/settings/search-provider/test` | 真实连接测试（产生一次真实请求；限流 6 次/10 分钟） |
| POST | `/api/settings/search-provider/disable` | 禁用 / 重新启用 `{ disabled: boolean }` |

## 搜索任务

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/search-tasks` | 任务列表（分页） |
| POST | `/api/search-tasks` | 创建任务（QUEUED；不发请求；REAL 模式过守卫）；支持 `questions:[{text,category}]` 做 Agent 临时搜索 |
| GET | `/api/search-tasks/[taskId]` | 任务详情 + 全部 item |
| POST | `/api/search-tasks/[taskId]/start` | 用户确认后启动（异步执行，返回即轮询） |
| POST | `/api/search-tasks/[taskId]/cancel` | 取消（排队即取消；执行中置 cancelRequested） |
| POST | `/api/search-tasks/[taskId]/retry` | 重试失败项（同样过守卫） |
| GET | `/api/search-tasks/[taskId]/results` | 结果列表（含证据 id/页面类型/来源角色/匹配依据/提及状态） |
| POST | `/api/search-tasks/[taskId]/retest` | 创建复测任务（继承问题集版本与参数，不复用结果） |
| GET/POST | `/api/search-tasks/[taskId]/snapshots` | 快照列表 / 补建 COLLECTION 或 RECOMPUTE 快照 |
| GET | `/api/matrix?brandId=&taskId=&includeMock=` | 品牌问题矩阵（服务端计算指标/状态/证据下钻） |

## 比较 / 报告

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/comparisons?baseline=&retest=` | 两轮比较：指标、共同子集、问题变化、页面变化、数据质量、波动 |
| GET/POST | `/api/reports` | 报告列表 / 生成报告（`taskId` + 可选 `compareTaskId`，或 `analysisTaskId`） |
| GET/PATCH/DELETE | `/api/reports/[reportId]` | 报告详情（含快照）/ 重命名 / 删除 |
| GET | `/api/reports/[reportId]/export` | 导出：`md` / `html` / `csv` / `questions-csv` / `evidence-csv` |

## 定时采集 / 优化事件

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/schedules` | 排期列表（含最近执行）/ 创建（真实模式需确认成本） |
| PATCH/DELETE | `/api/schedules/[scheduleId]` | 暂停/恢复/更新 / 取消（保留历史） |
| POST | `/api/schedules/[scheduleId]/run` | 用户主动立即执行一次 |
| POST | `/api/schedules/tick` | 调度 tick；配置 `CRON_SECRET` 时必须带 `x-cron-secret` |
| GET/POST | `/api/optimization-events` | 优化事件列表 / 创建（关联前后任务） |
| PATCH/DELETE | `/api/optimization-events/[eventId]` | 更新 / 删除 |

## 证据

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/evidence` | 证据列表（search/brandId/taskId/domain/mentionStatus/since + 分页） |
| POST | `/api/evidence` | 导出 CSV（按筛选，权限内数据，记审计） |
| GET/PATCH | `/api/evidence/[evidenceId]` | 详情（原始结果/页面分析/复核历史）/ 人工复核（`reviewAction`/页面类型/品牌归属/标签/相关性；不覆盖原始结果） |

## 分析

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/analytics/overview` | 总览指标 + 趋势 + 来源 + 最近任务/证据 |
| GET | `/api/analytics/visibility?brandId=` | 品牌可见度（指标/趋势/来源/竞品/分类） |
| GET | `/api/analytics/competitors?brandId=` | 竞品对比（同口径） |
| GET | `/api/analytics/sources` | 来源域名排行 |

## 优化建议 / 实验 / 大屏

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/recommendations` | 优化任务列表 |
| POST | `/api/recommendations?generate=true&brandId=` | 规则引擎生成建议 |
| POST | `/api/recommendations` | 手动创建优化任务 |
| PATCH/DELETE | `/api/recommendations/[recommendationId]` | 更新状态/内容 / 删除 |
| GET/POST | `/api/experiments` | 历史实验 + 候选任务 / 创建对比 |
| GET | `/api/wallboard` | 大屏数据（只读已保存数据） |

## 常见错误码

`UNAUTHENTICATED(401)` / `NO_WORKSPACE(403)` / `NOT_FOUND(404)` / `VALIDATION_ERROR(400)` / `PROVIDER_NOT_CONFIGURED` / `PROVIDER_NOT_CONNECTED` / `PROVIDER_DISABLED` / `INVALID_TASK_STATE(409)` / `RATE_LIMITED(429)` / `INTERNAL_ERROR(500)`
