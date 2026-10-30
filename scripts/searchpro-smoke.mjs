#!/usr/bin/env node
/**
 * Explicit real SearchPro acceptance smoke.
 *
 * Cost guard: requires CONFIRM_REAL_SEARCH=1 and a read/write GEO_RADAR_TOKEN.
 * It creates a small question set (4 queries), runs one REAL task and optionally
 * generates a report. It never prints API keys.
 *
 * PowerShell:
 *   $env:GEO_RADAR_URL="http://127.0.0.1:3000"
 *   $env:GEO_RADAR_TOKEN="gr_..."
 *   $env:CONFIRM_REAL_SEARCH="1"
 *   npm run searchpro:smoke:real
 */
const base = (process.env.GEO_RADAR_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const token = process.env.GEO_RADAR_TOKEN;
if (!token) throw new Error("GEO_RADAR_TOKEN required");
if (process.env.CONFIRM_REAL_SEARCH !== "1") {
  throw new Error("Refusing to spend real SearchPro quota. Set CONFIRM_REAL_SEARCH=1 after approval.");
}
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
async function api(path, init = {}) {
  const res = await fetch(base + path, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok || json?.ok === false) throw new Error(`${res.status}: ${json?.error?.message || text.slice(0, 300)}`);
  return json?.data ?? json;
}
const brandId = process.env.SEARCHPRO_BRAND_ID;
if (!brandId) throw new Error("SEARCHPRO_BRAND_ID required (find it via GET /api/brands).");
const queries = (process.env.SEARCHPRO_QUERIES || "元宝搜索是什么|腾讯元宝官网|元宝搜索 SearchPro 产品能力|豆包和 Kimi 的 AI 搜索对比").split("|").slice(0, 4);
const set = await api("/api/question-sets", {
  method: "POST",
  body: JSON.stringify({ name: `SearchPro REAL smoke ${new Date().toISOString().slice(0, 16)}`, description: "Explicit real SearchPro acceptance" }),
});
for (const [i, text] of queries.entries()) {
  await api("/api/questions", { method: "POST", body: JSON.stringify({ questionSetId: set.id, text, category: `SMOKE_${i + 1}`, priority: 5 }) });
}
const task = await api("/api/search-tasks", {
  method: "POST",
  body: JSON.stringify({
    name: `SearchPro REAL smoke ${new Date().toISOString().slice(0, 16)}`,
    brandId,
    questionSetId: set.id,
    executionMode: "REAL",
    maxResults: 10,
  }),
});
await api(`/api/search-tasks/${encodeURIComponent(task.id)}/start`, { method: "POST" });
const deadline = Date.now() + 120000;
let detail;
while (Date.now() < deadline) {
  detail = await api(`/api/search-tasks/${encodeURIComponent(task.id)}`);
  if (!["QUEUED", "RUNNING"].includes(detail.task.status)) break;
  await new Promise((r) => setTimeout(r, 1500));
}
const evidence = await api(`/api/evidence?taskId=${encodeURIComponent(task.id)}&pageSize=100`);
const report = ["COMPLETED", "PARTIAL_FAILED"].includes(detail.task.status)
  ? await api("/api/reports", { method: "POST", body: JSON.stringify({ taskId: task.id, title: `SearchPro REAL smoke ${new Date().toISOString().slice(0, 10)}` }) })
  : null;
console.log(JSON.stringify({
  taskId: task.id,
  status: detail.task.status,
  totalItems: detail.task.totalItems,
  successItems: detail.task.successItems,
  failedItems: detail.task.failedItems,
  emptyItems: detail.task.emptyItems,
  evidenceCount: evidence.total,
  requestIds: (detail.items || []).map((i) => i.providerRequestId).filter(Boolean),
  sampleUrls: (evidence.evidence || []).slice(0, 5).map((e) => e.url),
  reportId: report?.id ?? null,
  reportKind: report?.kind ?? null,
  failureReason: detail.task.failureReason,
}, null, 2));
