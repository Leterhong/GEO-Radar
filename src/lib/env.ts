// 环境变量统一读取入口。
// 涉及密钥的变量只在服务端读取，绝不通过 NEXT_PUBLIC_ 暴露。

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

export const env = {
  get databaseUrl(): string {
    const url = optional("DATABASE_URL");
    if (!url) throw new Error("缺少 DATABASE_URL 环境变量，请参考 .env.example 配置。");
    return url;
  },
  get authSecret(): string {
    const secret = optional("AUTH_SECRET");
    if (!secret) {
      throw new Error(
        "缺少 AUTH_SECRET 环境变量。请使用 `openssl rand -hex 32` 生成并写入 .env.local。"
      );
    }
    return secret;
  },
  get credentialEncryptionKey(): string | undefined {
    return optional("CREDENTIAL_ENCRYPTION_KEY");
  },
  get yuanbaoSearchEnabled(): boolean {
    return optional("YUANBAO_SEARCH_ENABLED") === "true";
  },
  /**
   * 元宝搜索服务 API Key（仅服务端）。
   * 用于首次引导：把环境变量中的密钥加密写入该工作空间的凭据记录；
   * 运行期一律以数据库密文为准，不直接读取本变量。
   */
  get yuanbaoSearchApiKey(): string | undefined {
    return optional("YUANBAO_SEARCH_API_KEY");
  },
  get yuanbaoSearchEndpoint(): string {
    // 默认使用官方服务 API Key 方式接口；仅在测试环境可通过环境变量覆盖指向 Mock Server。
    return optional("YUANBAO_SEARCH_ENDPOINT") ?? "https://api.wsa.cloud.tencent.com/SearchPro";
  },
  get searchConcurrency(): number {
    const raw = Number(optional("SEARCH_CONCURRENCY") ?? "2");
    return Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 5) : 2;
  },
  get searchTimeoutMs(): number {
    const raw = Number(optional("SEARCH_TIMEOUT_MS") ?? "30000");
    return Number.isFinite(raw) && raw >= 1000 ? Math.min(raw, 120000) : 30000;
  },
  /** 单次任务最多问题数（成本控制硬上限） */
  get maxQuestionsPerTask(): number {
    const raw = Number(optional("MAX_QUESTIONS_PER_TASK") ?? "100");
    return Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 200) : 100;
  },
  /** 单次任务最长执行时间（默认 30 分钟，最大 2 小时）；超时后停止派发新问题，已成功结果保留 */
  get taskTimeoutMs(): number {
    const raw = Number(optional("TASK_TIMEOUT_MS") ?? "1800000");
    return Number.isFinite(raw) && raw >= 60_000 ? Math.min(raw, 2 * 60 * 60 * 1000) : 30 * 60 * 1000;
  },
  /** 外部 cron 调用 /api/schedules/tick 的共享密钥；未配置时只能由登录用户触发当前工作空间 */
  get cronSecret(): string | undefined {
    return optional("CRON_SECRET");
  },
  /**
   * 仅用于自动化测试：允许基于 MOCK 任务生成报告以验证流程。
   * 生产环境不要设置；报告会明确标记模拟数据。
   */
  get allowMockReports(): boolean {
    return optional("ALLOW_MOCK_REPORTS") === "true";
  },
  get scheduleTickIntervalMs(): number {
    const raw = Number(optional("SCHEDULE_TICK_INTERVAL_MS") ?? "60000");
    return Number.isFinite(raw) && raw >= 30000 ? Math.min(raw, 10 * 60 * 1000) : 60000;
  },
  /** 同时运行的定时 / 手动采集任务上限（单实例语义） */
  get scheduleMaxConcurrent(): number {
    const raw = Number(optional("SCHEDULE_MAX_CONCURRENT") ?? "1");
    return Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 5) : 1;
  },
  /** 单个排期单轮最多问题数 */
  get scheduleMaxQuestions(): number {
    const raw = Number(optional("SCHEDULE_MAX_QUESTIONS") ?? "50");
    return Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 200) : 50;
  },
  /** 每个工作空间最多启用的排期数量 */
  get scheduleMaxActivePerWorkspace(): number {
    const raw = Number(optional("SCHEDULE_MAX_ACTIVE_PER_WORKSPACE") ?? "10");
    return Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 50) : 10;
  },
  get nodeEnv(): string {
    return process.env.NODE_ENV ?? "development";
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
};
