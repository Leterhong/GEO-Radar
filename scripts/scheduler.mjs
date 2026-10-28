/**
 * 独立调度进程：定时调用 Web 服务的 /api/schedules/tick。
 *
 * 用途：本地/单机部署时，无需额外的 cron 服务即可驱动定时采集。
 * 生产多实例：只运行一个 scheduler 进程，或用平台 cron（Vercel Cron / Kubernetes CronJob / crontab）。
 * 浏览器关闭不影响该进程；它不执行搜索本身，只触发服务端 tick。
 *
 * 使用：
 *   CRON_SECRET=xxx APP_URL=http://127.0.0.1:3000 npm run scheduler
 */

import fs from "node:fs";
import path from "node:path";

function loadEnvLocal() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    const key = match[1];
    let value = (match[2] ?? "").trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvLocal();

const appUrl = (process.env.APP_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const secret = process.env.CRON_SECRET;
const intervalMs = Math.max(30_000, Number(process.env.SCHEDULE_TICK_INTERVAL_MS ?? "60000") || 60_000);

if (!secret) {
  console.error("[scheduler] 缺少 CRON_SECRET。请设置后重启：CRON_SECRET=xxx APP_URL=http://127.0.0.1:3000 npm run scheduler");
  process.exit(1);
}

let stopping = false;

async function tick() {
  if (stopping) return;
  const startedAt = Date.now();
  try {
    const response = await fetch(`${appUrl}/api/schedules/tick`, {
      method: "POST",
      headers: { "x-cron-secret": secret, "Content-Type": "application/json" },
      body: "{}",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      console.error(`[scheduler] tick 失败 HTTP ${response.status}`, payload?.error?.message ?? "");
      return;
    }
    const data = payload.data;
    if (data.dueCount > 0) {
      console.log(
        `[scheduler] ${new Date().toISOString()} 到期 ${data.dueCount} 个，耗时 ${Date.now() - startedAt}ms`,
        data.results?.map((r) => `${r.scheduleId}:${r.status}${r.taskId ? `(${r.taskId})` : ""}`).join(", ")
      );
    }
  } catch (error) {
    console.error("[scheduler] tick 请求异常：", error instanceof Error ? error.message : error);
  }
}

console.log(`[scheduler] 已启动：${appUrl}/api/schedules/tick，间隔 ${Math.round(intervalMs / 1000)}s`);
void tick();
const timer = setInterval(() => void tick(), intervalMs);

function shutdown(signal) {
  console.log(`[scheduler] 收到 ${signal}，等待当前 tick 完成后退出`);
  stopping = true;
  clearInterval(timer);
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
