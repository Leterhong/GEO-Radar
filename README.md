<div align="center">

<img src="docs/assets/readme/hero.jpg" alt="GEO Radar — 把 AI 搜索网页结果变成可追溯的品牌证据" width="100%" />

# GEO Radar

**Evidence-first GEO platform for AI search visibility.**

把 AI 搜索的网页结果，变成可追溯、可复算、可复盘的品牌证据。

[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=nextdotjs)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-5.22-2D3748?logo=prisma)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql)](https://www.postgresql.org/)
[![Tests](https://img.shields.io/badge/tests-119%20passing-brightgreen)](#测试与验证)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Status](https://img.shields.io/badge/status-prototype-orange)](#已知限制)

[Live site](https://leterhong.github.io/GEO-Radar/) · [快速开始](#快速开始) · [核心能力](#核心能力) · [架构](#架构) · [元宝搜索接入](#元宝搜索接入) · [演示视频](#演示视频) · [文档](#文档)

**[简体中文](README.md) · [English](README.en.md)**

<img src="docs/assets/readme/demo.gif" alt="GEO Radar 证据详情演示：原始层不可变，分析层可复核" width="960" />

<sub>证据详情：元宝搜索原始结果 / RequestId 与规则分析、人工复核分层保存</sub>

</div>

---

> **一句话**：GEO Radar 不生产“AI 可见度分数”。它保存每一次真实搜索的原始结果，把每个页面变成可核对的证据，再在这之上计算指标、做矩阵、复测和报告。

> **状态**：可演示原型（prototype），真实调用过腾讯云元宝搜索 SearchPro。接口、指标口径和历史数据仍在持续迭代，欢迎 issue / PR。

---

## 为什么做 GEO Radar

当用户问 AI “哪款产品好用”，最终答案往往来自一组被检索到的网页。品牌真正需要回答的是：

- 这次提问，AI 搜到了哪些页面？
- 哪些页面提到了我的品牌，哪些在替竞品说话？
- 官网有没有被检索到？如果没有，是没收录、没排名，还是这次刚好没出现？
- 两轮复测之间，变化是优化带来的，还是搜索本身在波动？

大多数工具直接给一个分数。GEO Radar 的选择是反过来的：

```text
先保存真实结果 → 再做页面级证据 → 再计算指标 → 再做比较与报告
```

四个不可妥协的设计原则：

| 原则 | 具体做法 |
| --- | --- |
| **真实数据优先** | 真实任务与 Mock 任务在数据层隔离；Mock 不进入真实指标 |
| **证据可追溯** | 原始响应、`RequestId`、URL、摘要、页面类型、匹配依据全部保留 |
| **指标可复算** | 每个指标返回分子、分母、样本范围、公式版本，失败/空结果不混入分母 |
| **结论不过度承诺** | 波动分析只给观测区间，不冒充置信区间；相关不等于因果 |

---

## 核心能力

<table>
<tr>
<td width="50%">

### 🔎 元宝搜索接入
- SearchPro 服务 API Key，服务端 AES-256-GCM 加密
- 请求封装、超时、重试、取消、错误分类
- 每条结果保存 `RequestId`、标题、URL、摘要、站点
- 原始响应完整落库，分析层不覆盖原始数据

### 🧾 页面级证据链
- URL 规范化（跟踪参数、参数排序、尾斜杠、默认端口）
- 可解释页面分类：官网 / 产品 / 文档 / 媒体 / 电商 / 社区 / 其他
- 品牌匹配依据：官网域名、名称/别名、产品名、短别名待复核
- 人工复核保留操作人、时间、前后值

</td>
<td width="50%">

### 🧩 品牌问题矩阵
- 问题 × 品牌 / 竞品的单元格状态
- 已发现 / 未发现 / 失败 / 空结果 / 待复核分开
- 单元格可下钻到证据与原始搜索结果
- 服务端统一口径，全部展示分子 / 分母

### 📸 快照、复测与比较
- 每轮采集保存不可变 `COLLECTION` 快照
- 规则重算生成 `RECOMPUTE` 快照，不覆盖历史
- 两轮比较：共同问题子集、指标变化、页面增减
- 波动分析只给观测最小/最大/极差

### 📄 证据中心报告
- 14 节报告：指标口径、矩阵、官网覆盖、页面类型、代表证据、限制、建议
- HTML / Markdown / 指标 CSV / 问题 CSV / 证据 CSV
- 报告固定生成时快照和规则版本，可回到证据

### ⏱️ 定时采集
- 外部 cron / 独立 scheduler 进程
- 成本确认、并发上限、幂等执行
- 暂停 / 恢复 / 取消，失败保留失败状态

</td>
</tr>
</table>

---

## 产品截图

### 品牌问题矩阵

[![品牌问题矩阵](docs/assets/readme/matrix.jpg)](docs/assets/readme/matrix.jpg)

> 10 个问题 × 元宝 / 豆包 / Kimi；失败、空结果、未发现、待复核是不同状态。

### 任务执行明细

[![任务执行明细](docs/assets/readme/task.jpg)](docs/assets/readme/task.jpg)

> 每条问题都有结果数、耗时、`RequestId`；真实与 Mock 在标签上明确区分。

### 证据详情

[![证据详情](docs/assets/readme/evidence.jpg)](docs/assets/readme/evidence.jpg)

> 上层是元宝搜索原始返回，下层是规则分析和人工复核；原始层不可变。

### 证据中心报告

[![证据中心报告](docs/assets/readme/report.jpg)](docs/assets/readme/report.jpg)

> 报告保存生成时快照；指标带分子/分母、规则版本和代表证据。

---

## 架构

```mermaid
flowchart LR
    YB[元宝搜索<br/>SearchPro] -->|Query / Pages / RequestId| SE[Search Execution]
    SE --> RAW[(RawSearchResponse<br/>不可变)]
    SE --> EA[Evidence Analysis]
    EA -->|URL 规范化 / 页面分类 / 品牌匹配| EV[(Evidence)]
    EV --> MX[品牌问题矩阵]
    EV --> SN[(AnalysisSnapshot<br/>COLLECTION / RECOMPUTE)]
    SN --> CP[两轮比较]
    SN --> RP[证据中心报告]
    MX --> RP
    CP --> RP
    UI[Next.js App Router] --> API[API Routes<br/>withAuth / workspaceId]
    API --> SE
    API --> MX
    API --> CP
    API --> RP
    SCH[外部 cron / scheduler] -->|POST /api/schedules/tick| SE
    API --> DB[(PostgreSQL + Prisma)]
    SE --> DB
    EV --> DB
    SN --> DB
    RP --> DB
```

### 数据分层

```text
Yuanbao SearchPro
  └─ RawSearchResponse      完整 JSON / RequestId / 采集时间（不可变）
       └─ SearchResult      标题 / URL / 域名 / 摘要 / 位置
            └─ Evidence     页面类型 / 来源角色 / 匹配依据 / 人工复核
                 └─ AnalysisSnapshot
                      COLLECTION（采集时） / RECOMPUTE（重算时）
                      └─ Matrix / Comparison / Report
```

### 规则版本

| 规则 | 版本 | 作用 |
| --- | --- | --- |
| URL 规范化 | `url-norm-v1` | 去除跟踪参数、参数排序、统一尾斜杠 |
| 页面分类 | `page-classify-v1` | 官网/产品/文档/媒体/社区等可解释分类 |
| 品牌匹配 | `evidence-v2` | 官网、名称/别名、产品名、短别名待复核 |
| 矩阵指标 | `geo-metrics-v2` | 品牌提及、官网覆盖、第三方覆盖 |
| 分析快照 | `snapshot-v1` | 固定指标、矩阵、证据摘要 |
| 两轮比较 | `comparison-v1` | 共同问题、页面增减、质量、波动 |
| 搜索报告 | `search-report-v1` | 14 节证据中心报告 |

> 更完整的规则、数据字典和验证记录见 [docs/evidence-chain.md](docs/evidence-chain.md) 与 [docs/data-dictionary.md](docs/data-dictionary.md)。

---

## 元宝搜索接入

GEO Radar 的检索层只接一个外部数据源：**腾讯云元宝搜索 SearchPro**。它负责“检索到哪些网页”，不负责“生成最终回答”。

```text
POST https://api.wsa.cloud.tencent.com/SearchPro
Authorization: Bearer <Service API Key>
Body: { Query, ... }
Response: Pages[] + RequestId + Version + Msg
```

实现细节：

- API Key 只在服务端接收，使用 `AES-256-GCM` 加密后落库；任何接口都不返回完整 Key
- 请求层统一处理超时、重试、取消、HTTP 状态和业务错误分类
- 每条结果保留 `RequestId`，报告和证据详情可以回到“哪一次请求”
- 原始响应完整保存；URL 规范化、页面分类、品牌匹配只改分析层
- 真实任务必须显式开启 `YUANBAO_SEARCH_ENABLED=true` 并通过连接测试
- Mock 任务与真实任务分开展示；Mock 默认不进入真实指标、不生成正式报告

本次真实样本（10 个问题，第二轮复测）：

| 指标 | 结果 |
| --- | --- |
| 成功问题 | 10 / 10 |
| 返回结果 | 98 条 |
| 单请求耗时 | 81–385ms（本次样本，不代表所有网络条件） |
| 品牌提及问题率 | 6 / 10 = 60% |
| 官网结果覆盖率 | 0 / 10 = 0% |
| 第三方页面覆盖率 | 6 / 10 = 60% |
| 竞品提及率 | 豆包 70% / Kimi 70% |

> 为什么官网覆盖率是 0%？因为这次 98 条结果里没有任何页面来自 `yuanbao.tencent.com`，不是“未配置官网”的占位值。未配置官网时，平台会显示「不可计算 / 未配置」，不会显示 0%。

更多接入细节：[docs/yuanbao-integration.md](docs/yuanbao-integration.md) · [docs/api-integration.md](docs/api-integration.md)

---

## 快速开始

### 前置条件

- Node.js **20+**
- PostgreSQL **14+**（本地、Docker 或云数据库均可）
- 可选：元宝搜索 SearchPro 服务 API Key（不配置也可以先用 Mock 模式体验）

### 方式 0：Docker Compose 一键启动（推荐体验）

前置条件：Docker Desktop（Windows/macOS）或 Docker Engine + Compose v2。

```bash
git clone https://github.com/Leterhong/GEO-Radar.git
cd GEO-Radar
npm run docker:up
```

首次运行会自动生成 `.env.docker`（随机 secrets，不提交 Git），构建镜像、启动 PostgreSQL 和应用，并等待健康检查通过。默认访问：

```text
http://localhost:3000
```

停止 / 看日志：

```bash
npm run docker:down
npm run docker:logs
```

> Docker 镜像使用 Next.js standalone + PostgreSQL 16；首次构建需要下载依赖和镜像。若本机已有 3000/15432 端口占用，可设置 `APP_PORT=3300 POSTGRES_PORT=15433 npm run docker:up`。

### 方式 A：内嵌 PostgreSQL（最简单，无需安装）

> 内嵌数据库脚本当前主要面向 Windows（`@embedded-postgres/windows-x64`）；Linux/macOS 请使用方式 B 或 C。

```bash
git clone https://github.com/Leterhong/GEO-Radar.git
cd GEO-Radar
npm ci
cp .env.example .env.local
```

填写 `.env.local` 中的 `DATABASE_URL`、`AUTH_SECRET`、`CREDENTIAL_ENCRYPTION_KEY`：

```bash
# 生成 AUTH_SECRET / CREDENTIAL_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

启动内嵌数据库（**保持这个终端运行**）：

```bash
npm run dev:db
# postgres started on 127.0.0.1:15432
# DATABASE_URL=postgresql://georadar:georadar_dev_pw@localhost:15432/georadar
```

另开一个终端：

```bash
npm run db:migrate
npm run dev
```

打开 http://localhost:3000，注册账号即可。

### 方式 B：Docker PostgreSQL

```bash
docker compose up -d db
# 宿主机端口 15432
export DATABASE_URL="postgresql://georadar:georadar_dev_pw@localhost:15432/georadar"
npm run db:migrate
npm run dev
```

### 方式 C：已有 PostgreSQL

```bash
export DATABASE_URL="postgresql://user:password@host:5432/georadar"
npm run db:migrate
npm run dev
```

### 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | PostgreSQL 连接串 |
| `AUTH_SECRET` | 是 | 会话签名密钥，至少 32 字节随机值 |
| `CREDENTIAL_ENCRYPTION_KEY` | 是 | API Key 加密密钥，32 字节 hex，与数据分开管理 |
| `YUANBAO_SEARCH_ENABLED` | 否 | `true` 才允许真实元宝搜索请求 |
| `YUANBAO_SEARCH_API_KEY` | 否 | 可选，用于 `npm run key:import` 导入 |
| `SEARCH_CONCURRENCY` | 否 | 任务内并发，默认 2 |
| `SEARCH_TIMEOUT_MS` | 否 | 单请求超时，默认 30000 |
| `CRON_SECRET` | 否 | 外部调度调用 `/api/schedules/tick` 的共享密钥 |
| `APP_URL` | 否 | scheduler 访问的 Web 地址 |

完整配置见 [.env.example](.env.example) 与 [docs/deployment.md](docs/deployment.md)。

---

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 生产构建 |
| `npm run start` | 启动生产服务 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint |
| `npm test` | 运行 Vitest（119 个用例） |
| `npm run dev:db` | 启动内嵌 PostgreSQL（15432） |
| `npm run db:migrate` | 执行 Prisma 迁移 |
| `npm run db:status` | 查看迁移状态 |
| `npm run smoke` | 端到端冒烟（58 项） |
| `npm run smoke:evidence` | 证据链专项冒烟（42 项） |
| `npm run verify:ui` | Playwright UI 检查与截图 |
| `npm run scheduler` | 独立调度进程 |
| `npm run reset-password -- <email> <newpass>` | 本地重置密码 |
| `npm run key:import -- <email>` | 将 `.env.local` 中的 Key 加密导入 |

---

## 测试与验证

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

当前验证状态：

- **119 个 Vitest 用例**：证据链、矩阵、快照、比较、报告、调度、元宝 Provider、权限与集成流程
- **58 项端到端冒烟**：注册 → 建品牌/问题 → Mock 任务 → 证据 → 报告 → 导出
- **42 项证据链冒烟**：版本、人工复核、复测、比较、报告、定时、数据隔离
- **Playwright UI 检查**：核心页面截图与浏览器 console 错误检查
- 数据库集成测试在没有可用数据库时会自动 skip，不会伪造通过

> 测试数据和真实工作区隔离；`ui-*`、`smoke-*`、`evidence-smoke-*` 是测试账号前缀。

---

## 项目结构

```text
src/
  app/
    (auth)/              登录、注册
    (dashboard)/         总览、搜索实验室、矩阵、比较、证据、报告、排期
    api/                 REST API（auth / brands / questions / search-tasks / evidence / reports ...）
  components/            UI 组件（Radix + Tailwind）
  lib/
    providers/yuanbao/   元宝 SearchPro Provider、Schema、Mapper
    providers/mock/      Mock Provider（明确隔离）
    page-classification.ts
    url-normalization.ts
    schedule-time.ts
  server/
    auth/                会话、密码、权限
    services/            搜索执行、证据、矩阵、快照、比较、报告、调度
    security/            AES-256-GCM、日志脱敏
prisma/
  schema.prisma
  migrations/            非破坏性迁移
scripts/                 冒烟、调度、密码重置、视频/截图工具
tests/                   单元、集成、Playwright
docs/                    架构、数据字典、API、部署、证据链、案例
```

---

## 演示视频

[![GEO Radar 元宝搜索实战演示](docs/assets/readme/hero.jpg)](https://github.com/Leterhong/GEO-Radar/releases/download/v0.1.0/GEO-Radar-yuanbao-demo-1440p.mp4)

**7 分 57 秒 · 1440p · 真实元宝搜索调用 + 平台完整流程**

[▶ 观看完整演示](https://github.com/Leterhong/GEO-Radar/releases/download/v0.1.0/GEO-Radar-yuanbao-demo-1440p.mp4) · [字幕](docs/assets/video/georadar-yuanbao-tour.srt)

视频主线：

```text
元宝 SearchPro 能力 → 设置连接 → 品牌/问题配置 → 真实采集
→ 页面级证据 → 问题矩阵 → 快照 → 两轮比较 → 证据报告 → 架构
```

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/evidence-chain.md](docs/evidence-chain.md) | 证据链、矩阵、快照、复测、比较、报告与验证结果 |
| [docs/architecture.md](docs/architecture.md) | 系统架构与模块职责 |
| [docs/data-dictionary.md](docs/data-dictionary.md) | 数据模型与字段含义 |
| [docs/yuanbao-integration.md](docs/yuanbao-integration.md) | 元宝 SearchPro 接入与错误处理 |
| [docs/api-integration.md](docs/api-integration.md) | API 约定与示例 |
| [docs/geo-analysis.md](docs/geo-analysis.md) | GEO 指标口径与解释边界 |
| [docs/deployment.md](docs/deployment.md) | 部署、认证 Cookie、调度 |
| [docs/testing.md](docs/testing.md) | 测试与验证方法 |
| [docs/article-geo-radar.md](docs/article-geo-radar.md) | 实战文章：从真实搜索到证据平台 |
| [docs/csdn-submission.md](docs/csdn-submission.md) | 元宝搜索征文大赛提交说明 |
| [docs/change-set.md](docs/change-set.md) | 本轮变更文件清单 |

---

## 已知限制

- **PDF 导出未实现**：当前支持 HTML / Markdown / 指标 CSV / 问题 CSV / 证据 CSV，HTML 可打印为 PDF。
- **任务执行在 Web 进程内**：生产环境需要进程守护；重启会中断执行中的任务。
- **定时采集依赖外部调度**：`npm run scheduler` 或外部 cron 调用 `/api/schedules/tick`，没有内置常驻调度器。
- **页面分类是启发式规则**：长尾站点可能落到 OTHER/UNKNOWN，可人工修正或继续补规则。
- **波动分析不是置信区间**：只给观测区间，样本少或时间集中时不代表稳定分布。
- **真实 API 压测不足**：当前只做了小样本真实调用，未覆盖大规模并发、限流和持续运行。
- **速率限制是进程内内存**：多实例部署需要外部存储（Redis 等）。
- **旧任务可能没有 COLLECTION 快照**：比较页会在缺快照时回退实时证据并明确标注。
- **认证 Cookie 按 host:port 隔离**：切换访问地址需要重新登录，账号本身不受影响。

---

## Roadmap

- [ ] PDF 报告导出（无头浏览器 / 服务端渲染）
- [ ] 任务执行器拆分为独立 worker
- [ ] Redis 速率限制与队列
- [ ] 更多搜索 Provider（保持证据层协议一致）
- [ ] 页面分类规则包与可视化规则编辑器
- [ ] 更多报告模板与多语言
- [ ] 真实 API 压测与成本面板

---

## Contributing

欢迎 issue、讨论和 PR。开始之前：

1. 阅读 [CONTRIBUTING.md](CONTRIBUTING.md)
2. 不要提交 `.env.local`、API Key、数据库密码、客户数据
3. 修改指标/规则时，同时更新测试和文档中的口径
4. PR 请说明：解决什么问题、如何验证、是否影响历史数据

安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要开公开 issue 贴密钥。

---

## License

[MIT](LICENSE) © 2026 Leterhong

---

## Acknowledgements

- [腾讯云元宝搜索](https://cloud.tencent.com/product/wsa) — 真实网页检索能力
- [Next.js](https://nextjs.org/)、[React](https://react.dev/)、[TypeScript](https://www.typescriptlang.org/)
- [Prisma](https://www.prisma.io/)、[PostgreSQL](https://www.postgresql.org/)
- [Radix UI](https://www.radix-ui.com/)、[Tailwind CSS](https://tailwindcss.com/)、[Recharts](https://recharts.org/)
- [Vitest](https://vitest.dev/)、[Playwright](https://playwright.dev/)

> GEO Radar 是独立开源项目，与腾讯云/元宝搜索无隶属关系；元宝搜索为其外部数据源。

<div align="center">

**如果这个项目对你有帮助，欢迎 Star ⭐**

</div>
