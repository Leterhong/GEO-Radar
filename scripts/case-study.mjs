/**
 * 比赛实测用例一键执行器。
 *
 * 前置条件：在 GEO Radar「设置 → 元宝搜索数据源」中保存真实 API Key 并「测试连接」通过。
 * 作用：用固定的品牌 + 2 个竞品 + 10 个问题，走真实搜索任务链路，输出可直接粘进文章的实测表格。
 *
 * 用法：node scripts/case-study.mjs
 * 输出：docs/case-study-run.md（含请求 ID、耗时、返回条数、指标与分母）
 */
const BASE = process.env.CASE_BASE_URL ?? "http://localhost:3100";
const BRAND = { name: "元宝", aliases: ["腾讯元宝"], website: "https://yuanbao.tencent.com" };
const COMPETITORS = [
  { name: "豆包", aliases: ["Doubao"], website: "https://www.doubao.com" },
  { name: "Kimi", aliases: ["月之暗面 Kimi"], website: "https://kimi.moonshot.cn" },
];
const QUESTIONS = [
  "国内有哪些好用的 AI 搜索助手？",
  "AI 搜索工具怎么选，主要看哪些能力？",
  "腾讯元宝和豆包哪个更适合日常查资料？",
  "AI 搜索助手能直接给出带来源的答案吗？",
  "适合职场人用的 AI 问答工具有哪些？",
  "AI 搜索和传统搜索引擎的区别是什么？",
  "哪款 AI 助手的资料引用比较可靠？",
  "写报告时可以用哪些 AI 工具辅助查资料？",
  "手机上常用的 AI 搜索 App 推荐",
  "AI 搜索助手在中文长文理解上表现如何？",
];

let cookieJar = new Map();
function cookieHeader() {
  return Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}
async function api(path, options = {}) {
  const header = cookieHeader();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(header ? { cookie: header } : {}),
      ...(options.headers ?? {}),
    },
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(";")[0];
    const i = pair.indexOf("=");
    if (i > 0) cookieJar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const email = process.env.CASE_EMAIL;
  const password = process.env.CASE_PASSWORD;
  if (!email || !password) {
    console.error(
      "请先设置 CASE_EMAIL / CASE_PASSWORD（已配置好密钥的账号），例如：" + '\\n' +
      "  CASE_EMAIL=case@georadar.test CASE_PASSWORD=... node scripts/case-study.mjs"
    );
    process.exit(2);
  }
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  if (!login.json?.ok) throw new Error("登录失败，请检查 CASE_EMAIL / CASE_PASSWORD");

  // 数据源必须先通过真实连接测试
  const provider = await api("/api/settings/search-provider");
  if (provider.json?.data?.status !== "CONNECTED") {
    console.error(
      "\n[中止] 当前工作空间的数据源状态为 " +
        (provider.json?.data?.status ?? "未知") +
        "。\n请先在新账号的工作空间中配置真实元宝 API Key 并点击「测试连接」，再运行本脚本。\n" +
        "提示：本脚本会创建一个全新账号，因此更推荐用浏览器手动完成「创建品牌 → 建问题集 → 执行任务 → 截图」，再参考本脚本的输出格式整理数据。\n"
    );
    process.exit(2);
  }

  const brand = await api("/api/brands", {
    method: "POST",
    body: JSON.stringify({ name: BRAND.name, aliases: BRAND.aliases, websiteUrl: BRAND.website }),
  });
  const brandId = brand.json.data.id;
  for (const competitor of COMPETITORS) {
    await api("/api/competitors", {
      method: "POST",
      body: JSON.stringify({ brandId, name: competitor.name, aliases: competitor.aliases, websiteUrl: competitor.website }),
    });
  }

  const set = await api("/api/question-sets", {
    method: "POST",
    body: JSON.stringify({ name: "AI 搜索助手选择（实测问题集）" }),
  });
  const questionSetId = set.json.data.id;
  for (const text of QUESTIONS) {
    await api("/api/questions", { method: "POST", body: JSON.stringify({ questionSetId, text }) });
  }

  const startedAt = new Date();
  const task = await api("/api/search-tasks", {
    method: "POST",
    body: JSON.stringify({
      name: `实测：AI 搜索助手可见度（${startedAt.toISOString().slice(0, 10)}）`,
      brandId,
      questionSetId,
      executionMode: "REAL",
      maxResults: 10,
    }),
  });
  if (!task.json?.ok) throw new Error("创建任务失败: " + JSON.stringify(task.json));
  const taskId = task.json.data.id;
  await api(`/api/search-tasks/${taskId}/start`, { method: "POST" });

  let detail = null;
  for (let i = 0; i < 180; i += 1) {
    await sleep(2000);
    const st = await api(`/api/search-tasks/${taskId}`);
    detail = st.json?.data;
    if (detail?.task && !["QUEUED", "RUNNING"].includes(detail.task.status)) break;
    if (i % 5 === 0) console.log(`… 执行中 ${detail?.task?.successItems ?? 0}/${QUESTIONS.length}`);
  }

  const items = detail?.items ?? [];
  const results = await api(`/api/search-tasks/${taskId}/results`);
  const rows = results.json?.data?.results ?? [];
  const analysis = await api("/api/analytics/visibility?brandId=" + brandId);
  const metric = analysis.json?.data?.metrics;

  const lines = [];
  lines.push("# 实测运行结果（脚本自动生成）");
  lines.push("");
  lines.push(`- 运行时间：${startedAt.toISOString().slice(0, 19).replace("T", " ")}`);
  lines.push(`- 任务 ID：${taskId}`);
  lines.push(`- 任务状态：${detail?.task?.status}（成功 ${detail?.task?.successItems} / 失败 ${detail?.task?.failedItems} / 共 ${detail?.task?.totalItems}）`);
  lines.push(`- 品牌：${BRAND.name}（${BRAND.website}）`);
  lines.push(`- 竞品：${COMPETITORS.map((c) => c.name).join("、")}`);
  lines.push("");
  lines.push("## 每个问题的执行记录");
  lines.push("");
  lines.push("| # | 问题 | 状态 | 返回条数 | 耗时 | 尝试 | 供应商 RequestId |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  items.forEach((item, index) => {
    lines.push(
      `| ${index + 1} | ${item.questionText} | ${item.status} | ${item.resultCount} | ${
        item.durationMs ?? "—"
      }ms | ${item.attempts} | ${item.providerRequestId ?? "—"} |`
    );
  });
  lines.push("");
  lines.push(`共保存搜索结果 ${rows.length} 条，覆盖域名 ${new Set(rows.map((r) => r.domain).filter(Boolean)).size} 个。`);
  lines.push("");
  lines.push("## 指标（服务端计算，含分母）");
  lines.push("");
  if (metric) {
    const pct = (v) => (v === null ? "不可计算" : `${(v * 100).toFixed(1)}%`);
    lines.push("| 指标 | 数值 | 分子 | 分母 |");
    lines.push("| --- | --- | --- | --- |");
    lines.push(`| 品牌出现率 | ${pct(metric.brandAppearance.value)} | ${metric.brandAppearance.numerator} | ${metric.brandAppearance.validSamples} |`);
    lines.push(`| 问题覆盖率 | ${pct(metric.questionCoverage.value)} | ${metric.questionCoverage.numerator} | ${metric.questionCoverage.validSamples} |`);
    lines.push(`| 官网来源覆盖率 | ${pct(metric.officialSiteCoverage.value)} | ${metric.officialSiteCoverage.numerator} | ${metric.officialSiteCoverage.validSamples} |`);
  } else {
    lines.push("（指标接口未返回数据，请检查任务是否完成）");
  }
  const competitors = analysis.json?.data?.competitors ?? [];
  if (competitors.length > 0) {
    lines.push("");
    lines.push("| 竞品 | 出现率 | 有效样本 |");
    lines.push("| --- | --- | --- |");
    for (const c of competitors) {
      const rate = c.appearanceRate ?? c.value ?? null;
      lines.push(`| ${c.name} | ${rate === null ? "—" : (rate * 100).toFixed(1) + "%"} | ${c.validSamples} |`);
    }
  }

  const fs = await import("node:fs");
  fs.writeFileSync("docs/case-study-run.md", lines.join("\n") + "\n", "utf8");
  console.log("\n已写入 docs/case-study-run.md\n");
  console.log(lines.join("\n"));
  console.log("\n下一步截图：搜索实验室任务详情、证据库、品牌可见度、GEO 分析指标、分析报告。");
}

main().catch((error) => {
  console.error("执行失败:", error instanceof Error ? error.message : error);
  process.exit(1);
});
