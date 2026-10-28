# GEO Radar — GEO 分析、指标与报告

> 所有指标由服务端确定性代码计算并落库（含分子、分母、公式版本），语言模型不参与数值产生。
> 实现：`src/server/services/analysis/metrics-engine.ts`（纯函数）+ `analysis-service.ts`（执行与持久化）+ `report-service.ts`（快照与导出）。

## 1. 统计对象与分母

**分析数据源优先级：已保存数据（只读）**，不会自动发起搜索或模型调用。

- 主口径（answer 级）：会话「搜索并回答」模式中，状态 `COMPLETED` 且带 ≥1 条真实来源引用的执行记录。
- **分母 = 有效回答数**（有来源的回答）。搜索成功但 0 条结果的回答会单独计数（`answersWithoutSources`），**不进入分母**，避免"无结果"被当成"品牌未出现"。
- 补充维度（question 级）：实验室真实任务（`source=LAB`）按问题集统计的品牌出现率。

统计窗口：任务创建时选择的近 N 天（基于回答完成时间 `finishedAt`）。

## 2. 指标定义（公式版本 v1）

| 指标 | 分子 | 分母 |
| --- | --- | --- |
| 有效回答数 | 有真实来源的回答数 | 全部检索到的执行数（用于展示漏斗） |
| 品牌提及率 | 回答正文出现品牌名称/别名的回答数 | 有效回答数 |
| 品牌提及次数 | 所有有效回答中品牌名与别名的累计出现次数 | 有效回答数（仅用于展示） |
| 品牌引用率 | 引用了**可归因到本品牌**来源的回答数 | 有效回答数 |
| 官网引用率 | 引用了官网同站域名来源的回答数 | 有效回答数 |
| 竞品提及率（每个竞品） | 回答正文出现该竞品名称/别名的回答数 | 有效回答数 |
| 关键词表现 | 按问题是否包含品牌配置的关键词分组，统计各组品牌提及率 | 组内回答数 |
| 品牌提及趋势 | 按回答完成日期分组统计提及率 | 当日有效回答数 |
| 问题集表现（实验室） | 至少一条已确认品牌提及证据的问题数 | 该问题集有效完成问题数 |

**「品牌引用率」与「官网引用率」是两件事**：前者允许第三方来源（如媒体报道）被标记为"确认本品牌"；后者只统计官网同站域名。

### 品牌引用率的"可归因"判定

来源满足任一条件即计入：
1. 来源域名与品牌官网**同站**（registrable domain 一致，含子域，防伪装域名如 `yuanbao.tencent.com.evil.io`）；
2. 该来源对应的证据 `mentionStatus = CONFIRMED_BRAND`（规则或人工复核确认）。

**品牌名出现在回答正文里 ≠ 引用**——两者分开统计。

### 提及识别规则

- 文本规范化：全角转半角、小写、空白压缩。
- 拉丁词按词边界匹配（`Acmeless` 不算 `Acme`）；CJK 按包含匹配并累计出现次数。
- 品牌名 + 已登记别名都参与匹配。
- 歧义与低置信匹配可在证据库人工复核，复核结果参与引用率判定。

## 3. 样本不足处理

- 分母为 0 → `value = null`、`insufficient = true`，UI 显示「不可计算」而不是 0%，并给出原因说明。
- 分析任务状态：`COMPLETED`（有有效样本）/ `PARTIALLY_COMPLETED`（有效样本为 0，指标不可计算）/ `FAILED` / `CANCELLED`。
- 报告「数据限制」章节自动列出：无有效回答、部分执行无来源、未配置官网域名、部分指标样本不足。

## 4. 分析任务执行

1. `POST /api/analyses` 创建 `AnalysisTask`（QUEUED），立即返回。
2. 服务端异步执行：读取已保存 run/来源 → 计算 → 事务内写 `AnalysisMetric` → 更新任务状态与 `Brand.lastAnalyzedAt`。
3. 前端轮询 `GET /api/analyses/:id`（仅 QUEUED/RUNNING 时），展示真实状态。
4. `action=retry` 会先删除旧指标再重算（幂等），`action=cancel` 置为 CANCELLED。

**不产生外部调用**：分析不写 `UsageRecord`。

## 5. 报告

- 由已完成的、含指标快照的分析任务生成（`POST /api/reports`）。
- 保存 `snapshot`（JSON）与 `markdown` 两份快照，历史报告不随后续数据变化改写。
- 导出：`GET /api/reports/:id/export?format=md|csv`；CSV 含 `metric_key / value / numerator / denominator / formula_version / insufficient / notes`。
- 删除分析任务不会删除已生成报告（外键 `SetNull`，报告保留快照）。
- PDF 导出**未实现**，界面不提供该按钮。

## 6. 用量记录

- `UsageRecord` 在每次真实调用后写入：搜索（对话与实验室）、模型（含真实返回的 prompt/completion tokens）。
- 汇总接口 `GET /api/usage`：搜索请求数、模型调用数、失败数、已知 Token（未返回时显示「未知」）、费用（未提供时显示「未知」，不做估算）。
- 用量时间线默认近 30 天，历史调用以 `SearchTaskItem.executedAt` 与 `ConversationRun.finishedAt` 为准。
