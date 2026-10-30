# GEO Radar 平台升级交付报告

> 本轮目标：从「真实搜索证据工具」升级为「品牌 AI 搜索可见性监测与优化平台」。
> 原则：复用现有搜索、证据、矩阵、快照、比较、报告链路，不替换技术栈、不覆盖历史数据。

## 1. 技术架构

- 前端：Next.js 14 App Router、React 18、TypeScript、Tailwind CSS、Radix UI、Recharts
- 后端：Next.js Route Handlers、Prisma 5、PostgreSQL 16
- 搜索源：腾讯云元宝搜索 SearchPro（真实模式） + 显式隔离的 Mock
- 鉴权：Session Cookie + Workspace API Token（MCP/Agent）
- 部署：Node / Docker Compose；CI 包含 typecheck、lint、test、build、Docker 启动

## 2. 已实现

### Dashboard 工作台

- 顶部监测计数：品牌、竞品、有效问题样本、网页证据、最近采集、搜索任务
- 核心指标：品牌出现率、问题覆盖率、官网覆盖率、第三方页面覆盖率、已完成任务
- 待处理：失败任务、待复核证据、待处理优化、报告数
- 趋势：品牌出现率、官网覆盖率、第三方页面覆盖率
- 最近活动：搜索任务、证据、报告、人工复核
- 全部品牌视图不能混合计算单品牌趋势，会明确提示选择品牌

### 品牌与竞品

- 品牌新增英文名称；保留别名、产品、产品别名、官网、官方子域、行业、描述
- 竞品新增行业、产品、产品别名、启用状态
- 竞品支持新增、编辑、停用/启用、删除；字段变化写入审计可追溯的 API 层
- 问题集新增 CSV 导出（按当前筛选的问题集导出），已有导入保持不变
- 页面类型新增 `SOCIAL_MEDIA`、`REVIEW_PAGE`，并在证据列表/详情/矩阵中显示
- 竞品页面显示启用状态、别名/行业/产品摘要

### 优化中心

- 优化任务支持状态：待处理、进行中、待验证、已完成、已忽略
- 新增「优化事件与效果验证」区块
- 可记录：事件名称、品牌、发生时间、修改摘要、页面 URL、优化前/后任务
- 已关联前后任务的优化事件可直接跳转两轮比较，查看页面新增/消失/持续与指标变化
- 明确标注：只代表时间关联与观察变化，不证明因果

### 指标与规则修正

- 证据规则升级为 `evidence-v3`：新增品牌英文名称作为正式名称匹配依据
- 修复「每个问题取最新一次成功执行」的顺序不确定问题：
  - 总览指标
  - 竞品指标
  - 规则型优化建议
  现在统一按 `executedAt, createdAt` 升序取最后一条，避免历史任务顺序导致指标漂移。
- 趋势新增官网与第三方覆盖率；未配置官网时官网趋势返回空值而不是 0%。
- 优化建议去重覆盖 `NEEDS_VERIFICATION`，避免验证阶段重复生成同类型建议。

### 报告

- 报告详情新增「打印 / PDF」按钮，使用浏览器打印为 PDF
- 打印样式隐藏侧边栏和顶栏，只保留报告正文
- 已有 HTML / Markdown / 指标 CSV / 问题 CSV / 证据 CSV 导出保持不变

## 3. 数据库修改

迁移：

- `20261030000000_brand_competitor_profile`
  - `Brand.englishName`
  - `Competitor.industry`
  - `Competitor.products`
  - `Competitor.productAliases`
  - `Competitor.enabled`
- `20261030001000_optimization_needs_verification`
  - `OptimizationStatus.NEEDS_VERIFICATION`

已在本地库与全新 `georadar_ci_check` 库执行，`prisma migrate diff` 为空。

## 4. 测试与验证

- `npm run typecheck`：通过
- `npm run lint`：通过
- `npm test`：**125 passed / 8 files**
- `npm run build`：通过
- 浏览器实测：
  - `/dashboard` 200，无 console error
  - `/dashboard?brandId=...` 趋势图正常
  - `/competitors` 200，显示竞品启用状态
  - `/optimization` 200，显示优化事件区块
  - 优化事件「查看前后对比」跳转 `/compare?baseline=...&retest=...` 成功
  - `/reports/<id>` 200，打印按钮可用
  - `/questions` 200
- 新增 `tests/platform-upgrade.test.ts`，覆盖新增 schema 字段与 `NEEDS_VERIFICATION` 状态

## 5. 未完成 / 下一阶段

- 优化任务与页面 URL 的直接关联（目前页面 URL 记录在优化事件）
- 优化效果的独立报告类型（当前复用两轮比较报告）
- 定时采集的独立 worker（当前仍为 Web 进程内执行 + 外部调度）
- PDF 服务端生成（当前为浏览器打印/另存 PDF）
- 真实生产压测与 Redis 限流

## 6. 本地运行

```bash
npm run dev:db
npm run db:migrate
npm run dev
```

或：

```bash
npm run docker:up
```

详细部署与环境变量见 [deployment.md](deployment.md)。
