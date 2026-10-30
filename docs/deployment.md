# GEO Radar — 部署说明

## 1. 环境要求

- Node.js 20.19+ / 22.12+ / 24+（生产镜像使用 node:22-alpine）
- PostgreSQL 14+（推荐 16）
- Docker（可选，用于容器化部署或本地数据库）

## 2. 环境变量（复制 .env.example → .env.local）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | PostgreSQL 连接串 |
| `AUTH_SECRET` | 是 | 会话签名密钥，`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 生成 |
| `CREDENTIAL_ENCRYPTION_KEY` | 是* | 凭据加密密钥（32 字节 hex/base64）。未配置时无法保存元宝 API Key（明确报错，不降级明文） |
| `YUANBAO_SEARCH_ENABLED` | 否 | 默认 false；true 才允许真实元宝调用 |
| `YUANBAO_SEARCH_ENDPOINT` | 否 | 默认官方地址；仅测试环境允许覆盖（Provider 会警告非官方域名） |
| `SEARCH_CONCURRENCY` | 否 | 任务并发 1-5，默认 2 |
| `SEARCH_TIMEOUT_MS` | 否 | 单请求超时，默认 30000 |
| `MAX_QUESTIONS_PER_TASK` | 否 | 单次任务问题数硬上限，默认 100 |
| `TASK_TIMEOUT_MS` | 否 | 单次任务最长执行时间，默认 1800000（30 分钟），最大 2 小时 |
| `CRON_SECRET` | 否* | 外部 cron / scheduler 调用 `/api/schedules/tick` 的共享密钥；未配置时 tick 仅允许登录用户触发当前空间 |
| `APP_URL` | 否 | `scripts/scheduler.mjs` 访问的 Web 地址，默认 `http://127.0.0.1:3000` |
| `SCHEDULE_TICK_INTERVAL_MS` | 否 | 独立 scheduler 的 tick 间隔，默认 60000，最小 30000 |
| `SCHEDULE_MAX_CONCURRENT` | 否 | 同时运行的采集任务上限，默认 1 |
| `SCHEDULE_MAX_QUESTIONS` | 否 | 单排期单轮最多问题数，默认 50 |
| `SCHEDULE_MAX_ACTIVE_PER_WORKSPACE` | 否 | 每个工作空间最多启用排期数，默认 10 |

*生产环境必须配置。密钥与被加密数据分离存放（环境变量 vs 数据库密文）。

## 3. 认证 Cookie 与访问地址

- 会话 Cookie 的 `Secure` 属性按请求协议自动决定：HTTPS（或反向代理传 `x-forwarded-proto: https`）设置 Secure；HTTP（含局域网 IP）不设置，否则浏览器会拒绝 Cookie，表现为“登录成功但立即回到登录页”。
- Cookie 按 **host:port** 隔离：`localhost:3000`、`127.0.0.1:3000`、`192.168.x.x:3000` 是不同来源。请固定一个访问地址，否则每次换地址都需要重新登录（账号本身仍在）。
- 登录/注册限流按邮箱计数，避免同一台机器上的多个用户共享 `local` 计数桶互相阻塞。
- 账号存在于 `DATABASE_URL` 指向的数据库；切换数据库或重新初始化数据目录会导致“账号不见了”。忘记密码使用 `npm run reset-password -- <email> <newpass>`。

## 4. 本地开发

```bash
npm ci
cp .env.example .env.local   # 填入上述变量
# 方式 A：本机 PostgreSQL
# 方式 B：docker compose up db   （宿主机端口 15432）
npm run db:migrate:dev       # 首次：prisma migrate dev
npm run dev                  # http://localhost:3000
```

## 5. 生产构建与启动

```bash
npm run build
npm run start
```

或容器化：

```bash
export AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
export CREDENTIAL_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
docker compose up -d --build
# 应用容器启动时会先执行 prisma migrate deploy 再启动服务
```

## 6. 数据库迁移

- 迁移文件在 `prisma/migrations/`，初始迁移 `20260101000000_init`。
- 生产执行 `npm run db:migrate`（= `prisma migrate deploy`，幂等，不重置数据）。
- 容器 entrypoint 每次启动自动执行 `migrate deploy`。
- **禁止**对生产数据库执行 `prisma db push --force-reset` 或类似重置操作。

## 7. 日志与密钥管理

- 服务日志统一经过脱敏（已注册的密钥值与 `Bearer xxx` 形态都会被替换为 `[REDACTED]`）。
- 生产密钥管理建议：将 `CREDENTIAL_ENCRYPTION_KEY` 纳入 KMS/密钥管理，轮换时需同步解密旧数据（当前版本未内置轮换工具，轮换前请备份并制定方案）。
- 数据库中只存密文（`v1:iv:tag:cipher` 格式）与掩码。

## 8. 定时采集部署

定时采集不依赖浏览器页面，但需要外部调度入口：

- **Docker Compose 一键启动**：`npm run docker:up` 会同时启动 `scheduler` 服务，使用容器内 `http://app:3000/api/schedules/tick` 和自动生成的 `CRON_SECRET`，无需额外 cron。
- **单机 / 小规模（非 Docker）**：在 Web 服务之外运行一个 `npm run scheduler` 进程（与 Web 同一份代码、同一 `DATABASE_URL`/`CRON_SECRET`），默认每 60s 调用 `POST /api/schedules/tick`。
- **平台 cron（推荐多实例）**：配置平台定时任务调用 `POST https://your-host/api/schedules/tick`，请求头 `x-cron-secret: $CRON_SECRET`。只运行一个调度入口；`ScheduleRun(scheduleId, plannedAt)` 唯一约束会兜底重复触发。
- **未配置 CRON_SECRET**：tick 只允许已登录用户触发当前工作空间，适合开发/手动验证。

注意：

1. 任务执行仍在 Web 进程内，进程重启会中断执行中的任务；调度器会把该次执行标记为失败/中断，不会伪造结果。
2. 多实例部署不要同时运行多个 scheduler 进程（会产生无意义的并发检查）；用平台 cron 或 leader 选举。
3. 定时真实采集会产生持续 API 成本；排期创建时必须显式确认，且可随时暂停/取消。

## 9. 已知部署约束

1. **搜索任务执行器运行在 Web 进程内**：单实例 Node 部署可靠；多实例/serverless 部署需将执行器迁出为后台工作进程（接口不变），并在其前置队列服务。
2. **内存限流为单实例语义**：多实例需替换为共享存储实现（`src/server/api/helpers.ts` 的 `rateLimit`）。
3. **定时采集执行器仍在 Web 进程内**：Docker Compose 已内置 scheduler 服务；生产多实例仍建议使用平台 cron 或 leader 选举，避免多个调度入口。
4. Docker 构建（`npm ci` + next build）在无外网缓存环境耗时较长，首次构建请预留时间。
