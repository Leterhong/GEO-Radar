# GEO Radar — 数据字典

> 对应 Prisma Schema：`prisma/schema.prisma`。所有业务表通过 `workspaceId` 隔离。

## 用户与空间

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `User` | email(唯一), passwordHash, name | bcrypt(12) 哈希 |
| `Session` | tokenHash(唯一), expiresAt | SHA-256(token+AUTH_SECRET)，明文 token 只在 httpOnly Cookie |
| `Workspace` | name, ownerId | 注册自动创建个人空间 |
| `WorkspaceMember` | (workspaceId,userId) 唯一, role | OWNER/ADMIN/MEMBER |
| `AuditLog` | action, targetType, targetId, metadata | 不含密码与完整密钥 |

## 业务档案

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `Brand` | name, englishName, aliases[], websiteUrl, websiteDomain, officialSubdomains[], products[], productAliases[], keywords[], industry, description, matchConfig(JSON) | websiteDomain 由服务端从 URL 规范化提取；englishName 参与正式名称匹配；officialSubdomains 用于官网归属；products/productAliases 作为独立匹配依据；matchConfig 当前仅保存、不参与隐藏规则 |
| `Competitor` | brandId, name, aliases[], websiteDomain, industry, products[], productAliases[], enabled | 规则识别竞品提及；官网域名用于竞品官网页判定；enabled=false 的竞品不参与后续匹配、矩阵、指标与复测快照 |
| `QuestionSet` | name, description, currentVersion, archivedAt | 删除改为归档，保留历史任务与版本 |
| `Question` | questionSetId, text(≤300), category, intent, region, language, priority(1-5), enabled, version | region/language 仅内部记录，元宝接口不支持对应参数；version 为最近变更所属问题集版本 |
| `QuestionSetVersion` | questionSetId, version, name, description, questions(JSON), questionCount, enabledCount, note, createdById | 不可变快照；`(questionSetId, version)` 唯一；历史任务引用 |

## 数据源凭据

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `SearchProviderCredential` | workspaceId(唯一), provider, encryptedSecret, maskedSecret, status, lastTestedAt, lastTestDurationMs, lastTestRequestId, lastTestOk, lastErrorMessage | encryptedSecret 格式 `v1:iv:tag:cipher`（AES-256-GCM）；status ∈ NOT_CONFIGURED / PENDING_VERIFICATION / CONNECTED / FAILED / DISABLED；任何接口不返回完整 Key |

## 搜索任务链路

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `SearchTask` | provider(YUANBAO/MOCK), executionMode(REAL/MOCK), status(QUEUED/RUNNING/COMPLETED/PARTIAL_FAILED/FAILED/CANCELLED), source(LAB/CHAT/SCHEDULE), questionSetId, questionSetVersionId, questionSetVersion, totalItems, successItems, failedItems, emptyItems, parseErrorItems, failureReason, params(JSON), brandSnapshot(JSON), baselineTaskId, scheduleId, scheduleRunId, cancelRequested, startedAt/finishedAt | baselineTaskId 形成复测链；brandSnapshot 记录任务创建时的品牌/竞品匹配配置；emptyItems/parseErrorItems 单独统计，不混入失败 |
| `SearchTaskItem` | (taskId,questionId) 唯一, questionText 快照, categorySnapshot, status(PENDING/RUNNING/SUCCESS/FAILED/CANCELLED), attempts, error, errorCategory, providerRequestId, durationMs, httpStatus, resultCount, parseErrorCount | attempts 含每次重试；errorCategory=PARTIAL_PARSE 表示部分结果解析失败但任务成功；问题删除后 questionId 置空但文本保留 |
| `SearchResult` | taskId, itemId, questionId, position, title, url, domain, snippet(≤2000), publishedAt, isMock, extra(JSON) | 原始搜索结果；extra：fullContent/siteName/score/authorityLevel/pics/favicon/deeplinks——仅供应商真实返回时写入，否则 null |
| `RawSearchResponse` | taskId, itemId, provider, requestId, httpStatus, body(≤256KB), requestMeta(JSON), truncated | 原始响应快照与请求元数据（query/参数/版本/耗时/解析错误数，不含密钥）；保留策略见下 |
| `Evidence` | taskId, questionId, resultId, rawResponseId, brandId, title, url, normalizedUrl, domain, snippet, publishedAt, collectedAt, provider, requestId, isMock, pageType, pageTypeSource(RULE/MANUAL), pageTypeRule, sourceRole(OFFICIAL/THIRD_PARTY/UNKNOWN), mentionStatus, detectionMethod(RULE/MANUAL), brandMatchBasis[], matchedTerms[], competitorMatches[], officialDomainMatch, thirdPartyMention, ruleVersion, analyzedAt, tags[], relevance, reviewNote, reviewedAt/By | 分析层；原始 url 永不覆盖；normalizedUrl 仅用于比较/去重；ruleVersion 记录产生本行结论的规则版本 |
| `EvidenceReview` | evidenceId, reviewerId, action, previous(JSON), next(JSON), note | 每次人工复核留痕：确认/驳回/不确定/改页面类型/改品牌归属/元数据更新 |

## 快照、报告、定时、优化事件

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `AnalysisSnapshot` | taskId, kind(COLLECTION/RECOMPUTE), ruleVersion, questionSetVersionId/Version, summary(JSON), metrics(JSON), matrix(JSON), pageTypeDistribution(JSON), questionSnapshot(JSON), evidenceSnapshot(JSON), evidenceCount, truncated, createdById | `(taskId, kind, ruleVersion)` 唯一；重算不覆盖采集快照；证据摘要超 2000 条截断并标记 |
| `Report` | kind(ANALYSIS/SEARCH_EVIDENCE/COMPARISON), analysisTaskId, searchTaskId, baselineTaskId, retestTaskId, title, version, snapshot(JSON), markdown, dataWindowFrom/To | 报告快照不被后续数据改写；版本号按同任务同类型递增 |
| `OptimizationEvent` | brandId, name, occurredAt, contentChanged, pageUrls[], note, baselineTaskId, retestTaskId, createdById | 仅记录时间关联，报告/页面明确不推断因果 |
| `Schedule` | brandId, questionSetId, questionSetVersionId, name, frequency(DAILY/WEEKLY), timezone, hour, minute, weekday, executionMode, params(JSON), confirmedCost, status(ACTIVE/PAUSED/CANCELLED), nextRunAt, lastRunAt, lastRunStatus, failureCount | nextRunAt 按 IANA 时区计算；真实模式必须确认成本 |
| `ScheduleRun` | scheduleId, plannedAt, status(PENDING/RUNNING/COMPLETED/FAILED/SKIPPED), attempt, error, errorCategory, startedAt/finishedAt, taskId(关系) | `(scheduleId, plannedAt)` 唯一，重复 tick 幂等跳过 |

## 优化与实验（原有）

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `OptimizationTask` | title, description, type(BRAND_MISSING/COMPETITOR_ADVANTAGE/OFFICIAL_SITE_LOW/...), priority, status(OPEN/IN_PROGRESS/NEEDS_VERIFICATION/DONE/DISMISSED), evidenceIds[], questionRefs[], generatedBy(RULE_ENGINE/MANUAL) | 规则建议附描述性免责说明；待验证状态用于记录优化后等待复测 |
| `OptimizationEvent` | brandId, name, occurredAt, contentChanged, pageUrls[], note, baselineTaskId, retestTaskId, createdById | 仅记录时间关联，页面与报告明确不推断因果 |
| `AuditLog`（实验） | action=EXPERIMENT_CREATED, metadata.name/baselineTaskId/retestTaskId/comparison | 实验记录复用审计日志存储 |

## 数据保留

- `RawSearchResponse` 为最大占用项（单条上限 256KB）。建议按 `createdAt` 定期清理（如保留 90 天）；当前版本未内置定时清理任务，可用 SQL 或后续版本补充。
- `AnalysisSnapshot.evidenceSnapshot` 最多保存 2000 条证据摘要；完整原始结果仍从 `SearchResult` 追溯。
- 删除品牌/任务采用级联或 SetNull（见 schema）；问题删除时历史任务 questionId 置空、问题文本保留；问题集删除改为归档。
- 建议保留：`AnalysisSnapshot`、`Report`、`ScheduleRun`（审计与历史比较），除非用户明确删除。
