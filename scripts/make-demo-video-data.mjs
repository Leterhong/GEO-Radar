/**
 * 创建用于演示视频的完整 Mock 工作区，并输出页面所需 ID。
 * 运行前需启动 3200 服务并设置 ALLOW_MOCK_REPORTS=true。
 */
const BASE = "http://127.0.0.1:3200";
let cookies = new Map();
const email = `video-demo-${Date.now()}@georadar.test`;
const password = "DemoVideo123";
const name = "演示讲解";

function cookieHeader() {
  return Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}
async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(cookieHeader() ? { cookie: cookieHeader() } : {}),
      ...(options.headers ?? {}),
    },
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
}
async function pollTask(id) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await api(`/api/search-tasks/${id}`);
    const task = res.json?.data?.task;
    if (task && !["QUEUED", "RUNNING"].includes(task.status)) return task;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("task timeout " + id);
}

const reg = await api("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({ email, password, name, agreeTerms: true }),
});
if (reg.status !== 200) throw new Error("register failed " + JSON.stringify(reg.json));

const brand = await api("/api/brands", {
  method: "POST",
  body: JSON.stringify({
    name: "极光搜索",
    aliases: ["极光", "Aurora Search"],
    websiteUrl: "https://aurora-search.example.com",
    officialSubdomains: ["docs.aurora-search.example.com"],
    products: ["极光 Pro", "极光企业版"],
    productAliases: ["Aurora Pro"],
    industry: "AI 搜索",
    description: "面向职场人与中小团队的 AI 搜索与资料整理助手。",
    keywords: ["AI 搜索", "资料整理", "职场效率"],
  }),
});
const brandId = brand.json.data.id;

await api("/api/competitors", {
  method: "POST",
  body: JSON.stringify({
    brandId,
    name: "星云助手",
    aliases: ["星云", "Nebula"],
    websiteUrl: "https://nebula-assistant.example.com",
    description: "同类 AI 搜索助手竞品",
  }),
});

const set = await api("/api/question-sets", {
  method: "POST",
  body: JSON.stringify({ name: "2026 品牌 GEO 固定问题集", description: "按品牌认知、产品功能、对比、购买决策、行业知识、场景方案分组。" }),
});
const questionSetId = set.json.data.id;

const questions = [
  { text: "极光搜索是什么", category: "品牌认知" },
  { text: "极光搜索有哪些功能", category: "产品功能" },
  { text: "极光搜索和星云助手哪个好", category: "产品对比" },
  { text: "极光搜索值得购买吗", category: "购买决策" },
  { text: "AI 搜索工具怎么选", category: "行业知识" },
  { text: "适合职场人的 AI 搜索工具有哪些", category: "场景方案" },
];
for (const q of questions) {
  await api("/api/questions", { method: "POST", body: JSON.stringify({ questionSetId, ...q, priority: 4 }) });
}

const task = await api("/api/search-tasks", {
  method: "POST",
  body: JSON.stringify({
    name: "演示：第一轮全量采集",
    brandId,
    questionSetId,
    executionMode: "MOCK",
    maxResults: 5,
  }),
});
const baselineTaskId = task.json.data.id;
await api(`/api/search-tasks/${baselineTaskId}/start`, { method: "POST" });
const baseline = await pollTask(baselineTaskId);

const retest = await api(`/api/search-tasks/${baselineTaskId}/retest`, {
  method: "POST",
  body: JSON.stringify({ name: "演示：第二轮复测" }),
});
const retestTaskId = retest.json.data.task.id;
await api(`/api/search-tasks/${retestTaskId}/start`, { method: "POST" });
const retestDone = await pollTask(retestTaskId);

const report = await api("/api/reports", {
  method: "POST",
  body: JSON.stringify({
    taskId: retestTaskId,
    compareTaskId: baselineTaskId,
    title: "极光搜索 · GEO 搜索证据分析报告",
  }),
});
const reportId = report.json?.data?.id;

const schedule = await api("/api/schedules", {
  method: "POST",
  body: JSON.stringify({
    name: "核心问题每日监测",
    brandId,
    questionSetId,
    frequency: "DAILY",
    timezone: "Asia/Shanghai",
    hour: 9,
    minute: 0,
    executionMode: "MOCK",
    confirmedCost: true,
    params: { maxResults: 5 },
  }),
});
const scheduleId = schedule.json?.data?.schedule?.id;

await api("/api/optimization-events", {
  method: "POST",
  body: JSON.stringify({
    brandId,
    name: "产品页补充常见问题",
    occurredAt: new Date().toISOString(),
    contentChanged: "产品页新增 5 个高频问题，补充适用场景与价格说明。",
    pageUrls: ["https://aurora-search.example.com/product"],
    note: "演示事件：只记录时间关联，不推断因果。",
    baselineTaskId,
    retestTaskId,
  }),
});

const matrix = await api(`/api/matrix?brandId=${brandId}&includeMock=true`);
const dataset = matrix.json?.data?.dataset;
const evidenceId = dataset?.evidence?.[0]?.id;

console.log(JSON.stringify({
  base: BASE,
  email,
  password,
  brandId,
  questionSetId,
  baselineTaskId,
  retestTaskId,
  reportId,
  scheduleId,
  evidenceId,
  counts: dataset?.counts,
  metrics: dataset?.metrics?.filter((m) => !m.key.startsWith("competitor_")).map((m) => ({ key: m.key, value: m.value, n: m.numerator, d: m.denominator })),
}, null, 2));
