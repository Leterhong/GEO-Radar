/** 基于真实任务生成 GEO 分析 + 报告，并输出 ID 供截图使用 */
const BASE = "http://localhost:3100";
const jar = new Map();
const header = () => Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(header() ? { cookie: header() } : {}), ...(init.headers ?? {}) },
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(";")[0];
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!process.env.CASE_EMAIL || !process.env.CASE_PASSWORD) {
  console.error("请设置 CASE_EMAIL / CASE_PASSWORD 环境变量后重试");
  process.exit(2);
}
await api("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: process.env.CASE_EMAIL, password: process.env.CASE_PASSWORD }),
});

const brands = await api("/api/brands");
const brand = brands.json.data.brands.find((b) => b.name === "元宝");
const competitors = await api("/api/competitors");
const competitorIds = (competitors.json?.data?.competitors ?? []).filter((c) => c.brandId === brand.id).map((c) => c.id);

const analysis = await api("/api/analyses", {
  method: "POST",
  body: JSON.stringify({
    name: "10 月 AI 搜索助手可见度复盘（元宝 / 豆包 / Kimi）",
    brandId: brand.id,
    days: 30,
    competitorIds,
  }),
});
if (!analysis.json?.ok) throw new Error("创建分析任务失败：" + JSON.stringify(analysis.json));
const analysisId = analysis.json.data.id;

let detail = null;
for (let i = 0; i < 40; i += 1) {
  await sleep(600);
  const st = await api(`/api/analyses/${analysisId}`);
  detail = st.json?.data;
  if (detail?.task && !["QUEUED", "RUNNING"].includes(detail.task.status)) break;
}
console.log("analysis:", detail?.task?.status, "metrics:", detail?.metrics?.length);
for (const m of detail?.metrics ?? []) {
  console.log(` - ${m.label}: ${m.value === null ? "不可计算" : m.value} (${m.numerator}/${m.denominator})`);
}

const report = await api("/api/reports", {
  method: "POST",
  body: JSON.stringify({ analysisTaskId: analysisId, title: "元宝 vs 豆包 vs Kimi：AI 搜索助手可见度复盘（10 月）" }),
});
if (!report.json?.ok) throw new Error("生成报告失败：" + JSON.stringify(report.json));
console.log("report:", report.json.data.id, report.json.data.title);

const tasks = await api("/api/search-tasks?pageSize=5");
const latest = tasks.json.data.tasks.find((t) => t.executionMode === "REAL" && t.status === "COMPLETED");
console.log("taskId:", latest?.id);

const fs = await import("node:fs");
fs.writeFileSync(
  "docs/case-study-ids.json",
  JSON.stringify({ analysisId, reportId: report.json.data.id, taskId: latest?.id, brandId: brand.id }, null, 2)
);
console.log("ids written to docs/case-study-ids.json");
