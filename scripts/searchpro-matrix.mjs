#!/usr/bin/env node
/**
 * SearchPro acceptance matrix.
 *
 * Default: MOCK task, no external search cost.
 * Real: requires --real and CONFIRM_REAL_SEARCH=1; one task with 10 queries.
 *
 * PowerShell MOCK:
 *   $env:GEO_RADAR_TOKEN="gr_..."
 *   node scripts/searchpro-matrix.mjs --brand-id <id>
 *
 * Real (explicit approval):
 *   $env:CONFIRM_REAL_SEARCH="1"
 *   node scripts/searchpro-matrix.mjs --brand-id <id> --real
 */
const base = (process.env.GEO_RADAR_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const token = process.env.GEO_RADAR_TOKEN;
if (!token) throw new Error("GEO_RADAR_TOKEN required");
const args = process.argv.slice(2);
const real = args.includes("--real");
const brandId = process.env.SEARCHPRO_BRAND_ID || args[args.indexOf("--brand-id") + 1];
if (!brandId) throw new Error("SEARCHPRO_BRAND_ID or --brand-id is required");
if (real && process.env.CONFIRM_REAL_SEARCH !== "1") {
  throw new Error("Refusing real SearchPro matrix without CONFIRM_REAL_SEARCH=1.");
}
const matrix = [
  { category: "brand", query: "腾讯元宝" },
  { category: "official", query: "腾讯元宝 官网" },
  { category: "product", query: "腾讯元宝 SearchPro 产品" },
  { category: "service", query: "腾讯元宝 AI 搜索 服务" },
  { category: "competitor", query: "豆包 Kimi AI 搜索 对比" },
  { category: "industry", query: "AI 搜索 行业 趋势" },
  { category: "long_tail", query: "腾讯元宝 适合企业内容监测吗" },
  { category: "chinese", query: "中文 AI 搜索 品牌 可见度" },
  { category: "english", query: "Tencent Yuanbao AI search" },
  { category: "no_result", query: "zzzxqv-never-indexed-georadar-2026" },
];
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
async function api(path, init = {}) {
  const res = await fetch(base + path, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok || json?.ok === false) throw new Error(`${res.status}: ${json?.error?.message || text.slice(0, 300)}`);
  return json?.data ?? json;
}
const mode = real ? "REAL" : "MOCK";
const set = await api("/api/question-sets", {
  method: "POST",
  body: JSON.stringify({ name: `SearchPro matrix ${mode} ${new Date().toISOString().slice(0, 16)}`, description: "10-category matrix" }),
});
for (const item of matrix) {
  await api("/api/questions", {
    method: "POST",
    body: JSON.stringify({ questionSetId: set.id, text: item.query, category: item.category, priority: 5 }),
  });
}
const task = await api("/api/search-tasks", {
  method: "POST",
  body: JSON.stringify({
    name: `SearchPro matrix ${mode} ${new Date().toISOString().slice(0, 16)}`,
    brandId,
    questionSetId: set.id,
    executionMode: mode,
    maxResults: 10,
  }),
});
await api(`/api/search-tasks/${encodeURIComponent(task.id)}/start`, { method: "POST" });
const deadline = Date.now() + 180000;
let detail;
while (Date.now() < deadline) {
  detail = await api(`/api/search-tasks/${encodeURIComponent(task.id)}`);
  if (!["QUEUED", "RUNNING"].includes(detail.task.status)) break;
  await new Promise((r) => setTimeout(r, 1500));
}
const items = (detail.items || []).map((item) => ({
  category: item.categorySnapshot,
  query: item.questionText,
  status: item.status,
  resultCount: item.resultCount ?? 0,
  requestId: item.providerRequestId ?? null,
  error: item.error ?? null,
}));
const completed = items.filter((i) => i.status === "SUCCESS").length;
const failed = items.filter((i) => i.status === "FAILED").length;
const empty = items.filter((i) => i.status === "SUCCESS" && i.resultCount === 0).length;
console.log(JSON.stringify({
  mode,
  taskId: task.id,
  questionSetId: set.id,
  status: detail.task.status,
  total: items.length,
  completed,
  failed,
  empty,
  categories: Object.fromEntries([...new Set(matrix.map((m) => m.category))].map((c) => [c, items.filter((i) => i.category === c).length])),
  items,
  scope: "10-category representative matrix; not an all-industry/all-query coverage claim.",
}, null, 2));
