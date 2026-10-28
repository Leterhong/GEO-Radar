# 本次变更文件清单（2026-10-28）

> 说明：工作区不是 Git 仓库，以下为本次实际创建/修改的文件。`.env.local` 属于本机配置（未提交），未列入。

## 数据库

- `prisma/schema.prisma`
- `prisma/migrations/20261028150000_evidence_chain_matrix_snapshots/migration.sql`

## 领域工具（lib）

- `src/lib/url-normalization.ts`（新增）
- `src/lib/page-classification.ts`（新增）
- `src/lib/domain-utils.ts`（新增）
- `src/lib/schedule-time.ts`（新增）
- `src/lib/env.ts`
- `src/lib/utils.ts`
- `src/lib/validation/schemas.ts`

## 服务层（server/services）

- `src/server/services/brand-matching.ts`（新增）
- `src/server/services/question-set-service.ts`（新增）
- `src/server/services/matrix-service.ts`（新增）
- `src/server/services/snapshot-service.ts`（新增）
- `src/server/services/retest-service.ts`（新增）
- `src/server/services/comparison-service.ts`（新增）
- `src/server/services/collection-report-service.ts`（新增）
- `src/server/services/schedule-service.ts`（新增）
- `src/server/services/search-execution.ts`
- `src/server/services/mention-detection.ts`
- `src/server/services/domain-normalization.ts`（改为 re-export 纯函数）
- `src/server/services/metrics.ts`
- `src/server/services/experiments.ts`

## API 路由

- `src/app/api/matrix/route.ts`（新增）
- `src/app/api/comparisons/route.ts`（新增）
- `src/app/api/evidence/reanalyze/route.ts`（新增，历史证据重算）
- `src/app/api/search-tasks/[taskId]/retest/route.ts`（新增）
- `src/app/api/search-tasks/[taskId]/snapshots/route.ts`（新增）
- `src/app/api/schedules/route.ts`（新增）
- `src/app/api/schedules/[scheduleId]/route.ts`（新增）
- `src/app/api/schedules/[scheduleId]/run/route.ts`（新增）
- `src/app/api/schedules/tick/route.ts`（新增）
- `src/app/api/optimization-events/route.ts`（新增）
- `src/app/api/optimization-events/[eventId]/route.ts`（新增）
- `src/app/api/question-sets/[questionSetId]/copy/route.ts`（新增）
- `src/app/api/question-sets/[questionSetId]/versions/route.ts`（新增）
- `src/app/api/question-sets/route.ts`
- `src/app/api/question-sets/[questionSetId]/route.ts`
- `src/app/api/questions/route.ts`
- `src/app/api/questions/[questionId]/route.ts`
- `src/app/api/questions/import/route.ts`
- `src/app/api/brands/route.ts`
- `src/app/api/brands/[brandId]/route.ts`
- `src/app/api/evidence/route.ts`
- `src/app/api/evidence/[evidenceId]/route.ts`
- `src/app/api/reports/route.ts`
- `src/app/api/reports/[reportId]/route.ts`
- `src/app/api/reports/[reportId]/export/route.ts`
- `src/app/api/search-tasks/[taskId]/results/route.ts`

## 认证与会话

- `src/server/auth/session.ts`（按请求协议决定 Secure Cookie；HTTP 局域网登录修复）
- `src/app/api/auth/login/route.ts`（登录限流按邮箱）
- `src/app/api/auth/register/route.ts`（注册限流按邮箱；Secure Cookie）
- `src/app/api/onboarding/route.ts`
- `src/app/api/workspaces/active/route.ts`

## 页面与组件

- `src/app/(dashboard)/matrix/page.tsx`（新增）
- `src/components/matrix/matrix-client.tsx`（新增）
- `src/app/(dashboard)/evidence/[evidenceId]/page.tsx`（新增）
- `src/components/evidence/evidence-detail-client.tsx`（新增）
- `src/app/(dashboard)/compare/page.tsx`（新增）
- `src/components/comparison/comparison-client.tsx`（新增）
- `src/app/(dashboard)/snapshots/page.tsx`（新增）
- `src/components/snapshots/snapshot-actions.tsx`（新增）
- `src/app/(dashboard)/schedules/page.tsx`（新增）
- `src/components/schedules/schedules-client.tsx`（新增）
- `src/components/reports/collection-report-view.tsx`（新增）
- `src/app/(dashboard)/reports/page.tsx`
- `src/app/(dashboard)/reports/[reportId]/page.tsx`
- `src/components/reports/reports-client.tsx`
- `src/app/(dashboard)/search-lab/[taskId]/page.tsx`
- `src/components/search-lab/search-task-detail.tsx`
- `src/components/search-lab/search-lab-client.tsx`
- `src/app/(dashboard)/brands/page.tsx`
- `src/components/brands/brands-client.tsx`
- `src/app/(dashboard)/questions/page.tsx`
- `src/components/questions/questions-manager.tsx`
- `src/components/evidence/evidence-client.tsx`（页面类型筛选、重算历史证据）
- `src/components/layout/sidebar.tsx`
- `src/components/chat/source-cards.tsx`（修复 `<p>` 内嵌 Badge 的 hydration 错误）

## 测试与脚本

- `tests/evidence-chain.test.ts`（新增，24 项）
- `tests/integration-evidence-flow.test.ts`（新增，8 项）
- `scripts/smoke-evidence-chain.mjs`（新增）
- `scripts/ui-verify.mjs`（新增）
- `scripts/scheduler.mjs`（新增）
- `scripts/make-demo-video-data.mjs`（演示视频数据）
- `scripts/capture-video-assets.mjs`（2880×1620 页面截图，输出 1440p 视频）
- `scripts/build-demo-video.py`（Edge TTS 松弛版 + 场景视频）
- `scripts/burn-video-subtitles.py`（2560×1440 ASS 字幕烧录）
- `scripts/capture-yuanbao-assets.mjs`（元宝真实工作区截图 + SearchPro/架构页）
- `scripts/build-yuanbao-video.py`（元宝参赛视频）
- `scripts/burn-yuanbao-subtitles.py`（元宝视频字幕）
- `docs/assets/verification/*.png`（10 张验证截图）
- `docs/assets/video/`（1440p 成片、封面、字幕、页面截图、音色试听）
- `docs/assets/video/yuanbao-screens/`（元宝真实调用截图与架构页）

## 文档与配置

- `README.md`
- `.env.example`
- `next.config.mjs`（移除未采用的 instrumentation 实验配置）
- `package.json`（新增 `scheduler` / `smoke:evidence` / `verify:ui` 脚本）
- `docs/evidence-chain.md`（新增）
- `docs/video-script.md`（新增，视频旁白脚本）
- `docs/video-script-yuanbao.md`（新增，元宝参赛视频脚本）
- `docs/wechat-title-options.md`（新增，公众号标题方案）
- `docs/article-geo-radar.md`（补充“未配置官网”与 0% 的区别、版本说明）
- `docs/case-study-run.md`（补充官网 0% 的边界说明）
- `docs/architecture.md`
- `docs/data-dictionary.md`
- `docs/api-integration.md`
- `docs/testing.md`
- `docs/deployment.md`
