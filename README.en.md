<div align="center">

<img src="docs/assets/readme/hero.jpg" alt="GEO Radar — turn AI-search results into traceable brand evidence" width="100%" />

# GEO Radar

**Evidence-first GEO platform for AI search visibility.**

Turn real AI-search web results into traceable, recomputable and reviewable brand evidence.

[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=nextdotjs)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-5.22-2D3748?logo=prisma)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql)](https://www.postgresql.org/)
[![Tests](https://img.shields.io/badge/tests-119%20passing-brightgreen)](#testing)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Status](https://img.shields.io/badge/status-prototype-orange)](#known-limitations)

[Live site](https://leterhong.github.io/GEO-Radar/) · [Quick start](#quick-start) · [Features](#features) · [Architecture](#architecture) · [Yuanbao Search](#yuanbao-search) · [Demo](#demo) · [Docs](#documentation)

**[简体中文](README.md) · [English](README.en.md)**

<img src="docs/assets/readme/demo.gif" alt="GEO Radar evidence detail: immutable raw layer, reviewable analysis layer" width="960" />

<sub>Evidence detail: Yuanbao raw result / RequestId and rule analysis / human review are stored separately.</sub>

</div>

---

> **In one sentence**: GEO Radar does not produce an opaque “AI visibility score”. It stores the raw result of every real search, turns each page into verifiable evidence, and only then computes metrics, matrices, retests and reports.

> **Status**: prototype. It has made real calls to Tencent Cloud Yuanbao SearchPro. APIs, metric definitions and historical data are still evolving. Issues and PRs are welcome.

---

## Why GEO Radar

When users ask an AI “which product is good”, the final answer is usually assembled from retrieved web pages. A brand needs to answer:

- Which pages did the AI actually retrieve for this question?
- Which pages mention my brand, and which pages speak for competitors?
- Was the official site retrieved at all? If not, is it missing from the index, not ranked, or just absent from this query?
- Between two retests, did something change because of optimization, or because search results naturally fluctuate?

Most tools jump straight to a score. GEO Radar takes the opposite path:

```text
save real results → build page-level evidence → compute metrics → compare and report
```

Four non-negotiable principles:

| Principle | Implementation |
| --- | --- |
| **Real data first** | Real and Mock tasks are isolated; Mock never enters real metrics |
| **Traceable evidence** | Raw response, `RequestId`, URL, snippet, page type and match basis are kept |
| **Recomputable metrics** | Every metric exposes numerator, denominator, sample scope and formula version; failures/empties are not mixed into denominators |
| **No overclaiming** | Volatility only reports the observed range, not a confidence interval; correlation is not causation |

---

## Features

<table>
<tr>
<td width="50%">

### 🔎 Yuanbao SearchPro integration
- Service API Key encrypted server-side with AES-256-GCM
- Request wrapper, timeout, retry, cancel and error classification
- `RequestId`, title, URL, snippet and site persisted for every result
- Full raw response retained; analysis never overwrites raw data

### 🧾 Page-level evidence chain
- URL normalization (tracking params, parameter order, trailing slash, default port)
- Explainable page classification: official / product / docs / media / ecommerce / community / other
- Brand match basis: official domain, name/alias, product name, short alias pending review
- Human review keeps operator, timestamp and before/after values

</td>
<td width="50%">

### 🧩 Brand question matrix
- Question × brand / competitor cell states
- Found / not found / failed / empty / needs review are distinct
- Drill down from a cell to evidence and raw search results
- Server-side metrics always expose numerator / denominator

### 📸 Snapshots, retests and comparison
- Immutable `COLLECTION` snapshot after every run
- `RECOMPUTE` snapshot for recomputation with new rules
- Two-round comparison: common question subset, metric movement, page diff
- Volatility: observed min/max/range only

### 📄 Evidence-centered reports
- 14-section report: methodology, matrix, official coverage, page types, representative evidence, limitations, suggestions
- HTML / Markdown / metrics CSV / questions CSV / evidence CSV
- Report freezes a generation-time snapshot and rule versions

### ⏱️ Scheduled collection
- External cron / standalone scheduler process
- Cost confirmation, concurrency limits, idempotent execution
- Pause / resume / cancel; failures remain failures

</td>
</tr>
</table>

---

## Screenshots

### Brand question matrix

[![Brand question matrix](docs/assets/readme/matrix.jpg)](docs/assets/readme/matrix.jpg)

> 10 questions × Yuanbao / Doubao / Kimi; failure, empty, not found and needs-review are distinct states.

### Task execution details

[![Task execution details](docs/assets/readme/task.jpg)](docs/assets/readme/task.jpg)

> Every question has result count, duration and `RequestId`; real and Mock tasks are clearly labeled.

### Evidence detail

[![Evidence detail](docs/assets/readme/evidence.jpg)](docs/assets/readme/evidence.jpg)

> Raw Yuanbao response on top; rule analysis and human review below. The raw layer is immutable.

### Evidence-centered report

[![Evidence-centered report](docs/assets/readme/report.jpg)](docs/assets/readme/report.jpg)

> Reports freeze a snapshot; metrics include numerator/denominator, rule versions and representative evidence.

---

## Architecture

```mermaid
flowchart LR
    YB[Yuanbao Search<br/>SearchPro] -->|Query / Pages / RequestId| SE[Search Execution]
    SE --> RAW[(RawSearchResponse<br/>immutable)]
    SE --> EA[Evidence Analysis]
    EA -->|URL normalization / page classification / brand match| EV[(Evidence)]
    EV --> MX[Brand question matrix]
    EV --> SN[(AnalysisSnapshot<br/>COLLECTION / RECOMPUTE)]
    SN --> CP[Two-round comparison]
    SN --> RP[Evidence-centered report]
    MX --> RP
    CP --> RP
    UI[Next.js App Router] --> API[API Routes<br/>withAuth / workspaceId]
    API --> SE
    API --> MX
    API --> CP
    API --> RP
    SCH[External cron / scheduler] -->|POST /api/schedules/tick| SE
    API --> DB[(PostgreSQL + Prisma)]
    SE --> DB
    EV --> DB
    SN --> DB
    RP --> DB
```

### Data layers

```text
Yuanbao SearchPro
  └─ RawSearchResponse      full JSON / RequestId / collectedAt (immutable)
       └─ SearchResult      title / URL / domain / snippet / position
            └─ Evidence     page type / source role / match basis / human review
                 └─ AnalysisSnapshot
                      COLLECTION (at collection) / RECOMPUTE (when recomputing)
                      └─ Matrix / Comparison / Report
```

### Rule versions

| Rule | Version | Purpose |
| --- | --- | --- |
| URL normalization | `url-norm-v1` | remove tracking params, sort params, normalize trailing slash |
| Page classification | `page-classify-v1` | explainable official/product/docs/media/community classes |
| Brand matching | `evidence-v2` | official domain, name/alias, product name, short aliases pending review |
| Matrix metrics | `geo-metrics-v2` | brand mention, official coverage, third-party coverage |
| Analysis snapshot | `snapshot-v1` | freeze metrics, matrix and evidence summary |
| Two-round comparison | `comparison-v1` | common questions, page diff, quality, volatility |
| Search report | `search-report-v1` | 14-section evidence-centered report |

> See [docs/evidence-chain.md](docs/evidence-chain.md) and [docs/data-dictionary.md](docs/data-dictionary.md) for details.

---

## Yuanbao Search

GEO Radar has exactly one external search source: **Tencent Cloud Yuanbao SearchPro**. It answers “which web pages were retrieved”, not “what is the final answer”.

```text
POST https://api.wsa.cloud.tencent.com/SearchPro
Authorization: Bearer <Service API Key>
Body: { Query, ... }
Response: Pages[] + RequestId + Version + Msg
```

Implementation details:

- API Key is accepted server-side only, encrypted with AES-256-GCM, never returned in full
- Request layer handles timeout, retry, cancel, HTTP status and business error classification
- Every result keeps `RequestId`; evidence and reports can point back to the exact request
- Full raw response is retained; URL normalization, page classification and brand matching only change the analysis layer
- Real tasks require `YUANBAO_SEARCH_ENABLED=true` and a passed connection test
- Mock tasks are explicitly separated; Mock does not enter real metrics or formal reports by default

Real sample (10 questions, second retest):

| Metric | Result |
| --- | --- |
| Successful questions | 10 / 10 |
| Results | 98 |
| Per-request duration | 81–385ms (this sample, not all network conditions) |
| Brand mention question rate | 6 / 10 = 60% |
| Official site coverage | 0 / 10 = 0% |
| Third-party page coverage | 6 / 10 = 60% |
| Competitor mention | Doubao 70% / Kimi 70% |

> Why is official coverage 0%? Because none of the 98 results came from `yuanbao.tencent.com` in this sample. This is not the placeholder for “official domain not configured”. When no official domain is configured, the platform shows “not configured / not computable”, never 0%.

More: [docs/yuanbao-integration.md](docs/yuanbao-integration.md) · [docs/api-integration.md](docs/api-integration.md)

---

## Quick start

### Prerequisites

- Node.js **20+**
- PostgreSQL **14+** (local, Docker or managed)
- Optional: Yuanbao SearchPro API Key (Mock mode works without it)

### Option 0: Docker Compose (recommended for a quick demo)

```bash
git clone https://github.com/Leterhong/GEO-Radar.git
cd GEO-Radar
npm run docker:up
```

The first run generates `.env.docker` with random local secrets (never commit it), builds the image, starts PostgreSQL + app, and waits for health checks.

```text
http://localhost:3000
```

Stop / logs:

```bash
npm run docker:down
npm run docker:logs
```

> The image uses Next.js standalone + PostgreSQL 16. If ports 3000/15432 are already in use, run `APP_PORT=3300 POSTGRES_PORT=15433 npm run docker:up`.

### Option A: Embedded PostgreSQL (Windows)

> The embedded DB helper targets Windows (`@embedded-postgres/windows-x64`); Linux/macOS should use Option B or C.

```bash
npm ci
cp .env.example .env.local
# fill DATABASE_URL, AUTH_SECRET, CREDENTIAL_ENCRYPTION_KEY
npm run dev:db      # keep this terminal running
# another terminal:
npm run db:migrate
npm run dev
```

### Option B: Docker PostgreSQL

```bash
docker compose up -d db
export DATABASE_URL="postgresql://georadar:georadar_dev_pw@localhost:15432/georadar"
npm run db:migrate
npm run dev
```

### Option C: Existing PostgreSQL

```bash
export DATABASE_URL="postgresql://user:password@host:5432/georadar"
npm run db:migrate
npm run dev
```

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `AUTH_SECRET` | yes | session signing secret, at least 32 random bytes |
| `CREDENTIAL_ENCRYPTION_KEY` | yes | 32-byte hex AES-256-GCM key, separated from data |
| `YUANBAO_SEARCH_ENABLED` | no | `true` enables real Yuanbao calls |
| `YUANBAO_SEARCH_API_KEY` | no | optional import helper |
| `SEARCH_CONCURRENCY` | no | in-task concurrency, default 2 |
| `SEARCH_TIMEOUT_MS` | no | request timeout, default 30000 |
| `CRON_SECRET` | no | shared secret for `/api/schedules/tick` |
| `APP_URL` | no | scheduler base URL |

See [.env.example](.env.example) and [docs/deployment.md](docs/deployment.md).

---

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | start dev server |
| `npm run build` | production build |
| `npm run start` | start production server |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Vitest (119 tests) |
| `npm run dev:db` | embedded PostgreSQL (15432, Windows) |
| `npm run db:migrate` | apply Prisma migrations |
| `npm run db:status` | migration status |
| `npm run docker:up` | one-command Docker demo |
| `npm run docker:down` | stop Docker demo |
| `npm run docker:logs` | follow Docker logs |
| `npm run smoke` | end-to-end smoke (58 checks) |
| `npm run smoke:evidence` | evidence-chain smoke (42 checks) |
| `npm run verify:ui` | Playwright UI checks and screenshots |
| `npm run scheduler` | standalone scheduler |
| `npm run reset-password -- <email> <newpass>` | reset a local password |
| `npm run key:import -- <email>` | import key from `.env.local` |

---

## Testing

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Current verification:

- **119 Vitest tests**: evidence chain, matrix, snapshots, comparison, reports, scheduling, Yuanbao provider, permissions and integration flow
- **58 end-to-end smoke checks**: register → brand/questions → Mock task → evidence → report → export
- **42 evidence-chain smoke checks**: versions, human review, retest, comparison, report, schedules, isolation
- **Playwright UI checks**: key pages and browser console errors
- Database integration tests skip automatically when no database is available

> Test data is isolated from real workspaces. Accounts starting with `ui-*`, `smoke-*`, `evidence-smoke-*` are test accounts.

---

## Project structure

```text
src/
  app/
    (auth)/              login / register
    (dashboard)/         overview, lab, matrix, compare, evidence, reports, schedules
    api/                 REST APIs (auth / brands / questions / search-tasks / evidence / reports ...)
  components/            UI (Radix + Tailwind)
  lib/
    providers/yuanbao/   SearchPro provider, schema, mapper
    providers/mock/      Mock provider (explicitly isolated)
    page-classification.ts
    url-normalization.ts
    schedule-time.ts
  server/
    auth/                session, password, guards
    services/            search execution, evidence, matrix, snapshot, comparison, report, schedule
    security/            AES-256-GCM, log redaction
prisma/
  schema.prisma
  migrations/            non-destructive migrations
scripts/                 smoke, scheduler, password reset, Docker, video/screenshot tools
tests/                   unit, integration, Playwright
docs/                    architecture, data dictionary, API, deployment, evidence chain, case study
```

---

## Demo

[![GEO Radar Yuanbao Search demo](docs/assets/readme/hero.jpg)](https://github.com/Leterhong/GEO-Radar/releases/download/v0.1.0/GEO-Radar-yuanbao-demo-1440p.mp4)

**7 min 57 s · 1440p · real Yuanbao Search calls + full platform flow**

[▶ Watch the demo](https://github.com/Leterhong/GEO-Radar/releases/download/v0.1.0/GEO-Radar-yuanbao-demo-1440p.mp4)

```text
Yuanbao SearchPro capabilities → connection → brand/questions → real collection
→ page-level evidence → matrix → snapshots → two-round comparison → report → architecture
```

---

## Documentation

| Document | Content |
| --- | --- |
| [docs/evidence-chain.md](docs/evidence-chain.md) | evidence chain, matrix, snapshots, retest, comparison, report |
| [docs/architecture.md](docs/architecture.md) | system architecture and modules |
| [docs/data-dictionary.md](docs/data-dictionary.md) | data model and fields |
| [docs/yuanbao-integration.md](docs/yuanbao-integration.md) | SearchPro integration and errors |
| [docs/api-integration.md](docs/api-integration.md) | API conventions and examples |
| [docs/geo-analysis.md](docs/geo-analysis.md) | GEO metrics and interpretation boundaries |
| [docs/deployment.md](docs/deployment.md) | deployment, auth cookies, scheduling |
| [docs/testing.md](docs/testing.md) | testing and verification |
| [docs/article-geo-radar.md](docs/article-geo-radar.md) | case study: from real search to evidence platform |

---

## Known limitations

- **PDF export not implemented**: HTML / Markdown / metrics CSV / questions CSV / evidence CSV are supported; HTML can be printed to PDF.
- **Task execution runs inside the web process**: a restart interrupts running tasks; production should use a process supervisor/worker.
- **External scheduler required**: `npm run scheduler` or external cron calling `/api/schedules/tick`; no built-in always-on scheduler.
- **Page classification is heuristic**: long-tail sites may fall into OTHER/UNKNOWN; humans can correct.
- **Volatility is not a confidence interval**: only the observed range; small or time-clustered samples are not a stable distribution.
- **Limited real API stress testing**: small real-call samples only; no large-scale concurrency/rate-limit/soak test.
- **Rate limiting is in-memory**: multi-instance deployments need Redis or another shared store.
- **Legacy tasks may lack COLLECTION snapshots**: comparison falls back to live evidence and labels it explicitly.
- **Auth cookie is host:port scoped**: switching URL requires login again; the account itself is unaffected.

---

## Roadmap

- [ ] PDF report export (headless browser / server rendering)
- [ ] Separate task worker
- [ ] Redis rate limiting and queue
- [ ] More search providers with the same evidence protocol
- [ ] Page-classification rule packs and visual editor
- [ ] More report templates and i18n
- [ ] Real API load testing and cost dashboard

---

## Contributing

Issues, discussions and PRs are welcome. Please:

1. Read [CONTRIBUTING.md](CONTRIBUTING.md)
2. Never commit `.env.local`, API keys, database passwords or customer data
3. Update tests and docs when changing metrics/rules
4. Explain the problem, verification steps and historical-data impact in a PR

For security issues, follow [SECURITY.md](SECURITY.md). Do not open a public issue with secrets.

---

## License

[MIT](LICENSE) © 2026 Leterhong

---

## Acknowledgements

- [Tencent Cloud Yuanbao Search](https://cloud.tencent.com/product/wsa) — real web retrieval
- [Next.js](https://nextjs.org/), [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/)
- [Prisma](https://www.prisma.io/), [PostgreSQL](https://www.postgresql.org/)
- [Radix UI](https://www.radix-ui.com/), [Tailwind CSS](https://tailwindcss.com/), [Recharts](https://recharts.org/)
- [Vitest](https://vitest.dev/), [Playwright](https://playwright.dev/)

> GEO Radar is an independent open-source project and is not affiliated with Tencent Cloud/Yuanbao Search; Yuanbao Search is an external data source.

<div align="center">

**If this project helps you, please Star ⭐**

</div>
