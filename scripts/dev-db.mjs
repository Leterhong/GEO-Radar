/**
 * 启动内嵌 PostgreSQL（仅本地开发/测试）。
 * 用法：node scripts/dev-db.mjs  → 在 127.0.0.1:15432 提供 georadar 库
 * 数据目录：.pgdata（已在 .gitignore 中排除，不入库）
 */
import EmbeddedPostgres from "embedded-postgres";
import { mkdirSync } from "fs";
import path from "path";

const dataDir = path.resolve(".pgdata");
mkdirSync(dataDir, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "georadar",
  password: "georadar_dev_pw",
  port: 15432,
  persistent: true,
});

async function main() {
  try {
    await pg.initialise();
    console.log("[dev-db] initialised data dir");
  } catch (e) {
    console.log("[dev-db] initialise skipped:", e.message?.split("\n")[0]);
  }
  try {
    await pg.start();
    console.log("[dev-db] postgres started on 127.0.0.1:15432");
  } catch (e) {
    console.log("[dev-db] start (may already be running):", e.message?.split("\n")[0]);
  }
  try {
    await pg.createDatabase("georadar");
    console.log("[dev-db] database georadar created");
  } catch (e) {
    console.log("[dev-db] database exists");
  }
  console.log("[dev-db] ready. DATABASE_URL=postgresql://georadar:georadar_dev_pw@localhost:15432/georadar");
  // 保持进程与事件循环存活（Ctrl+C 停止并清理）
  const keepAlive = setInterval(() => undefined, 60000);
  const shutdown = async () => {
    clearInterval(keepAlive);
    try {
      await pg.stop();
    } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("[dev-db] failed:", e);
  process.exit(1);
});
