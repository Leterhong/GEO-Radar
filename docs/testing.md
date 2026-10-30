# GEO Radar — 测试说明

## 1. 测试矩阵（2026-10-28 实际执行）

| 层级 | 框架 | 位置 | 状态 |
| --- | --- | --- | --- |
| 单元测试（Provider/解析/校验/指标口径纯函数/识别规则/CSV/URL/页面分类/时间计算） | Vitest | `tests/*.test.ts` | 131 个用例全部通过（9 个测试文件） |
| 数据库集成（品牌/问题集版本/采集/证据/矩阵/快照/复测/比较/报告/定时） | Vitest + PostgreSQL | `tests/integration-evidence-flow.test.ts` | 8 个用例通过；数据库不可用时自动 skip 并打印原因 |
| 原 E2E API 冒烟（注册→引导→问题集→守卫→模拟流程→权限） | Node 脚本 | `scripts/smoke.mjs` | 58 项检查通过（需 :3100 生产构建 + 数据库） |
| 新证据链 API 冒烟 | Node 脚本 | `scripts/smoke-evidence-chain.mjs` | 全部通过（需 `ALLOW_MOCK_REPORTS=true`） |
| 浏览器 UI 验证 | Playwright Chromium | `scripts/ui-verify.mjs` | 全部通过，无未捕获 JS 错误，截图见 `docs/assets/verification/` |
| Playwright E2E 套件 | Playwright | `tests/e2e/core-flow.spec.ts` | 已编写；本环境未执行套件（改用 `ui-verify.mjs` 验证核心页面） |

## 2. 新增测试覆盖

`tests/evidence-chain.test.ts`（24 项）：

- URL 规范化：跟踪参数、保留内容参数、尾斜杠、默认端口、fragment、百分号编码、非法 URL、不同页面不合并；
- 页面分类：官网首页/产品/文档/博客、第三方媒体/社区/电商、OTHER/UNKNOWN、冒牌域名不误判；
- 品牌匹配：官网强信号、标题/摘要/别名/产品名依据、短别名待复核、仅竞品、空文本；
- 定时时间：IANA 时区、每日/每周、UTC 换算、非法时区。

`tests/integration-evidence-flow.test.ts`（9 项）：

- 创建品牌/问题集（含版本 1）→ Mock 采集 → 原始结果与证据分离 → COLLECTION 快照；
- 失败问题显示 TASK_FAILED，不进入分母，不当作未发现；
- 复测创建时无结果、执行后独立生成证据；
- 两轮比较（共同问题、共同子集、页面持续、波动说明）；
- 生成对比报告并验证 Markdown/HTML/3 类 CSV；
- 定时排期到期执行、完成任务、推进下次时间、幂等 tick；
- 编辑问题生成新版本，历史任务问题文本不被覆盖。

## 3. 运行方式

```bash
# 单元测试
npm test
npm run test:watch

# 数据库集成测试（自动从 .env.local 读取 DATABASE_URL；不可用时 skip）
npx vitest run tests/integration-evidence-flow.test.ts

# 类型 / 风格 / 构建
npm run typecheck
npm run lint
npm run build

# E2E API 冒烟（先启动 :3100 生产服务）
npm run start -- -p 3100        # 或 npx next start -p 3100
node scripts/smoke.mjs

# 新证据链冒烟（测试环境临时开启 mock 报告）
#   PowerShell: $env:ALLOW_MOCK_REPORTS="true"; npx next start -p 3100
node scripts/smoke-evidence-chain.mjs

# 浏览器 UI 验证 + 截图
node scripts/ui-verify.mjs

# Playwright E2E 套件（可选，需要浏览器）
npx playwright install chromium
npx playwright test
```

## 4. 集成测试的数据库依赖

- 本地推荐：`npm run dev:db`（内嵌 PostgreSQL，端口 15432）后 `npm run db:migrate:dev`。
- 集成测试使用唯一工作空间并在 `afterAll` 清理；不会读写其他用户数据。
- 数据库不可用时测试文件会明确打印 `[integration] 数据库不可用，跳过集成测试`，不会伪装通过。

## 5. 真实 API 验证

2026-10-28 使用现有已连接凭据执行 **1 次受控单请求**（1 个问题）：

- 任务 `COMPLETED`，成功 1 / 失败 0；
- 10 条真实结果，`isMock=false`；
- 证据 `normalizedUrl` 与 `ruleVersion=evidence-v3` 均写入；
- 验证后删除临时任务与原始响应。

未进行批量/持续真实调用测试；真实账号权限、计费与限流以官方控制台为准。

## 6. 数据隔离测试要点

- Mock 任务/结果带 `isMock=true` 与「模拟数据」UI 徽章；统计查询过滤 `executionMode=REAL`。
- 失败/取消的 item 不进入指标分母；矩阵状态区分 TASK_FAILED / EMPTY，不与 NOT_FOUND 混淆。
- 连接测试失败不会显示「已连接」；Mock 测试连接不改变真实凭据状态。
- 所有新增 API 均通过 `withAuth` 解析工作空间，资源查询带 `workspaceId` 条件；跨空间返回 404。

## 7. 尚未验证 / 已知缺口

1. Playwright 的完整 `tests/e2e/core-flow.spec.ts` 套件未在当前环境运行（使用 `ui-verify.mjs` 覆盖核心页面）。
2. 多实例部署下的内存限流与任务执行器（见 architecture.md 执行宿主限制）。
3. 大规模真实 API 稳定性/限流/计费（仅单次受控验证）。
4. PDF 报告导出（可通过 HTML 打印替代）。
