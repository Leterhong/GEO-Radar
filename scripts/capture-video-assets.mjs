import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:3000";
const EMAIL = "video-demo-1793175917239@georadar.test";
const PASSWORD = "DemoVideo123";
const BRAND_ID = "cmvrun5zq000awqdnw2opit90";
const BASELINE = "cmvrun6gn001hwqdnt4id9nj7";
const RETEST = "cmvrun708005gwqdnujqwdiq8";
const REPORT = "cmvrun7df009fwqdn8r057mjy";
const EVIDENCE = "cmvrun71x0063wqdnfe89rg0q";
const outDir = path.resolve("docs/assets/video/screens");
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1.5 });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("Failed to fetch RSC payload")) errors.push(m.text());
});

async function shot(name) {
  await page.waitForTimeout(700);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log("shot", name, fs.statSync(file).size);
}

function titleSlide({ kicker, title, subtitle, points = [] }) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;width:1920px;height:1080px;overflow:hidden;
    font-family:"Microsoft YaHei","PingFang SC",sans-serif;
    background:
      radial-gradient(circle at 78% 20%, rgba(45,212,191,.18), transparent 38%),
      radial-gradient(circle at 18% 82%, rgba(59,130,246,.16), transparent 42%),
      linear-gradient(135deg,#f7fbff 0%,#f3f8f5 52%,#eef6ff 100%);
    color:#0f1f33;padding:108px 120px;display:flex;flex-direction:column;justify-content:center;position:relative}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(15,31,51,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(15,31,51,.035) 1px,transparent 1px);background-size:64px 64px;mask-image:linear-gradient(120deg,rgba(0,0,0,.7),transparent 75%)}
  .brand{display:flex;align-items:center;gap:18px;margin-bottom:46px;position:relative}
  .logo{width:54px;height:54px;border-radius:16px;background:linear-gradient(135deg,#2563eb,#14b8a6);box-shadow:0 16px 40px rgba(37,99,235,.22);display:flex;align-items:center;justify-content:center;color:#fff;font-size:26px;font-weight:700}
  .brand b{font-size:23px;letter-spacing:.5px}
  .kicker{font-size:19px;letter-spacing:4px;color:#2563eb;font-weight:700;margin-bottom:18px;position:relative}
  h1{font-size:82px;line-height:1.12;letter-spacing:-2px;margin:0 0 28px;max-width:1460px;position:relative}
  .sub{font-size:30px;line-height:1.55;color:#41556b;max-width:1160px;position:relative}
  .accent{color:#0f766e}
  .points{display:flex;gap:16px;margin-top:56px;flex-wrap:wrap;position:relative}
  .point{padding:16px 22px;border-radius:999px;border:1px solid rgba(15,31,51,.12);background:rgba(255,255,255,.72);font-size:19px;color:#334b63}
  .meta{position:absolute;bottom:64px;left:120px;font-size:17px;color:#718096;letter-spacing:1px}
  .orb{position:absolute;border-radius:50%;filter:blur(2px);opacity:.5}
  .o1{width:340px;height:340px;right:110px;top:100px;background:radial-gradient(circle,#5eead4,transparent 66%)}
  .o2{width:260px;height:260px;right:290px;bottom:80px;background:radial-gradient(circle,#93c5fd,transparent 66%)}
  </style></head><body><div class="grid"></div><div class="orb o1"></div><div class="orb o2"></div>
  <div class="brand"><div class="logo">G</div><b>GEO Radar</b></div>
  <div class="kicker">${kicker}</div><h1>${title}</h1><div class="sub">${subtitle}</div>
  ${points.length ? `<div class="points">${points.map((p) => `<div class="point">${p}</div>`).join("")}</div>` : ""}
  <div class="meta">功能全景与使用演示 · 2026</div></body></html>`;
}

function sectionSlide(num, title, subtitle) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;width:1920px;height:1080px;overflow:hidden;
    font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#eaf6f4;
    background:radial-gradient(circle at 82% 16%,rgba(45,212,191,.24),transparent 36%),
      radial-gradient(circle at 18% 86%,rgba(37,99,235,.26),transparent 42%),
      linear-gradient(135deg,#071827 0%,#0c2437 55%,#102f3e 100%);
    padding:110px 120px;display:flex;flex-direction:column;justify-content:center;position:relative}
  .num{font-size:220px;line-height:1;font-weight:800;letter-spacing:-10px;color:rgba(94,234,212,.16);position:absolute;right:105px;top:75px}
  .kicker{font-size:18px;letter-spacing:6px;color:#5eead4;margin-bottom:22px}
  h2{font-size:74px;line-height:1.15;margin:0 0 24px;letter-spacing:-1px}
  p{font-size:28px;line-height:1.6;color:#a9c4ce;max-width:1100px;margin:0}
  .line{width:120px;height:4px;background:linear-gradient(90deg,#5eead4,#3b82f6);border-radius:9px;margin-bottom:30px}
  .meta{position:absolute;bottom:64px;left:120px;font-size:16px;color:#6f8b98;letter-spacing:2px}
  </style></head><body><div class="num">${num}</div><div class="kicker">GEO RADAR · 功能演示</div>
  <div class="line"></div><h2>${title}</h2><p>${subtitle}</p>
  <div class="meta">${num} / 05</div></body></html>`;
}

function archSlide1() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;width:1920px;height:1080px;overflow:hidden;color:#eaf6f4;
    font-family:"Microsoft YaHei","PingFang SC",sans-serif;
    background:radial-gradient(circle at 84% 10%,rgba(45,212,191,.18),transparent 34%),
      radial-gradient(circle at 12% 92%,rgba(37,99,235,.2),transparent 38%),
      linear-gradient(135deg,#071827,#0b2437 58%,#102f3e);padding:72px 92px;
    display:flex;flex-direction:column;justify-content:center}
  .head{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:28px}
  .kicker{font-size:16px;letter-spacing:5px;color:#5eead4;margin-bottom:12px}
  h1{font-size:52px;margin:0;letter-spacing:-1px}
  .sub{font-size:20px;color:#9bb7c3;margin-top:12px}
  .stamp{font-size:14px;color:#6f8b98;letter-spacing:2px;text-align:right}
  .band{display:grid;grid-template-columns:150px 1fr;gap:20px;align-items:center;margin-top:15px;
    padding:17px 22px;border:1px solid rgba(148,211,220,.18);border-radius:18px;background:rgba(255,255,255,.035)}
  .label{font-size:15px;color:#5eead4;letter-spacing:2px;font-weight:700}
  .flow{display:flex;align-items:center;gap:12px;flex-wrap:nowrap}
  .node{padding:12px 16px;border-radius:12px;border:1px solid rgba(148,211,220,.24);background:rgba(7,24,39,.55);font-size:17px;white-space:nowrap}
  .node b{display:block;font-size:18px;margin-bottom:4px;color:#fff}
  .node small{font-size:12px;color:#8daab6}
  .arrow{font-size:24px;color:#5eead4;flex:0 0 auto}
  .wide{flex:1;text-align:center}
  .band .note{font-size:13px;color:#7e9aa7;margin-left:8px}
  </style></head><body>
  <div class="head"><div><div class="kicker">ARCHITECTURE / 01</div><h1>系统架构：一条可追溯的证据流水线</h1>
  <div class="sub">接入、执行、分析、快照、报告彼此解耦；所有数据按 workspaceId 隔离。</div></div>
  <div class="stamp">GEO RADAR<br>NEXT.JS + PRISMA</div></div>
  <div class="band"><div class="label">接入与鉴权</div><div class="flow">
    <div class="node wide"><b>Next.js App Router</b><small>页面 · API Routes · Server Components</small></div><div class="arrow">→</div>
    <div class="node wide"><b>withAuth / workspaceId</b><small>会话校验 · 工作空间隔离 · 权限</small></div></div></div>
  <div class="band"><div class="label">外部与执行</div><div class="flow">
    <div class="node"><b>元宝 SearchPro</b><small>真实网页结果 · RequestId</small></div><div class="arrow">→</div>
    <div class="node"><b>Search Execution</b><small>问题快照 · 重试 · 超时 · 取消</small></div><div class="arrow">→</div>
    <div class="node"><b>Evidence Analysis</b><small>URL 规范化 · 页面分类 · 品牌匹配</small></div></div></div>
  <div class="band"><div class="label">领域与数据</div><div class="flow">
    <div class="node wide"><b>Matrix / Snapshot / Comparison / Report / Schedule</b><small>矩阵 · 快照 · 两轮比较 · 报告 · 排期</small></div><div class="arrow">→</div>
    <div class="node wide"><b>PostgreSQL + Prisma</b><small>RawSearchResponse · Evidence · Snapshot · Report</small></div></div></div>
  <div class="band"><div class="label">外部调度</div><div class="flow">
    <div class="node"><b>cron / scheduler</b><small>独立进程 · 不依赖浏览器</small></div><div class="arrow">→</div>
    <div class="node"><b>POST /api/schedules/tick</b><small>CRON_SECRET · 幂等创建任务</small></div><div class="arrow">→</div>
    <div class="node"><b>ScheduleRun</b><small>执行记录 · 失败保留 · 不补假数据</small></div></div></div>
  </body></html>`;
}

function archSlide2() {
  const rows = [
    ["原始层", "RawSearchResponse", "完整响应 JSON · RequestId · 采集时间", "不可变"],
    ["结果层", "SearchResult", "标题 · URL · 域名 · 摘要 · 位置", "url-norm-v1"],
    ["证据层", "Evidence", "页面类型 · 来源角色 · 匹配依据 · 人工复核", "evidence-v2"],
    ["快照层", "AnalysisSnapshot", "COLLECTION / RECOMPUTE · 指标分子分母", "snapshot-v1"],
  ];
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;width:1920px;height:1080px;overflow:hidden;color:#eaf6f4;
    font-family:"Microsoft YaHei","PingFang SC",sans-serif;
    background:radial-gradient(circle at 82% 14%,rgba(45,212,191,.2),transparent 34%),
      radial-gradient(circle at 16% 88%,rgba(37,99,235,.22),transparent 40%),
      linear-gradient(135deg,#071827,#0b2437 58%,#102f3e);padding:72px 92px;
    display:flex;flex-direction:column;justify-content:center}
  .kicker{font-size:16px;letter-spacing:5px;color:#5eead4;margin-bottom:12px}
  h1{font-size:52px;margin:0 0 10px;letter-spacing:-1px}
  .sub{font-size:20px;color:#9bb7c3;margin-bottom:30px}
  .rows{display:flex;flex-direction:column;gap:13px}
  .row{display:grid;grid-template-columns:130px 1fr 220px;gap:18px;align-items:center;
    padding:18px 22px;border:1px solid rgba(148,211,220,.18);border-radius:18px;background:rgba(255,255,255,.035)}
  .row .layer{font-size:15px;color:#5eead4;letter-spacing:2px;font-weight:700}
  .row .name b{font-size:24px;display:block;margin-bottom:4px}
  .row .name small{font-size:14px;color:#8daab6}
  .tag{font-size:13px;color:#b8d7df;text-align:right;border:1px dashed rgba(148,211,220,.28);border-radius:999px;padding:7px 12px;justify-self:end}
  .outs{display:flex;gap:12px;margin-top:22px;margin-left:130px}
  .out{padding:12px 18px;border-radius:12px;background:rgba(94,234,212,.09);border:1px solid rgba(94,234,212,.25);font-size:16px}
  .note{margin-top:26px;font-size:16px;color:#9bb7c3;line-height:1.7;border-left:3px solid #5eead4;padding-left:16px}
  .arrowdown{text-align:center;color:#5eead4;font-size:20px;line-height:1;margin-left:130px;width:calc(100% - 130px)}
  </style></head><body>
  <div class="kicker">ARCHITECTURE / 02</div><h1>数据分层：原始不可变，分析可重算</h1>
  <div class="sub">越往下越接近原始事实；越往上越接近业务结论。每层都有规则版本。</div>
  <div class="rows">
  ${rows.map((r, i) => `${i ? '<div class="arrowdown">↓</div>' : ''}<div class="row"><div class="layer">${r[0]}</div><div class="name"><b>${r[1]}</b><small>${r[2]}</small></div><div class="tag">${r[3]}</div></div>`).join("")}
  </div>
  <div class="outs"><div class="out">品牌问题矩阵</div><div class="out">两轮比较</div><div class="out">证据中心报告</div></div>
  <div class="note">原始层只追加、不覆盖；人工复核只改分析层；重算生成新的 RECOMPUTE 快照，历史 COLLECTION 快照保持不变。</div>
  </body></html>`;
}

async function shootHtml(name, html) {
  await page.setContent(html);
  await shot(name);
}

async function section(name, num, title, subtitle) {
  await shootHtml(name, sectionSlide(num, title, subtitle));
}

await page.setContent(titleSlide({
  kicker: "GEO · 真实搜索证据",
  title: "看见品牌，<span class=\"accent\">在 AI 搜索里的真实位置</span>",
  subtitle: "从一条真实搜索结果，到可追溯的页面证据、品牌问题矩阵、复测对比和可信报告。",
  points: ["页面级证据链", "品牌问题矩阵", "历史快照与复测", "证据中心报告", "定时采集"],
}));
await shot("00-title");
await section("00b-section-1", "01", "配置：先把品牌与问题定义清楚", "品牌别名、官网与官方子域、产品名，以及固定问题集的版本管理。");

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL("**/dashboard", { timeout: 20_000 }), page.locator('button[type="submit"]').click()]);
await page.waitForTimeout(800);

const pages = [
  ["01-dashboard", "/dashboard"],
  ["02-brands", "/brands"],
  ["03-questions", "/questions"],
  ["04-search-lab", "/search-lab"],
  ["05-task-items", `/search-lab/${RETEST}`],
  ["06-evidence-list", "/evidence"],
  ["07-evidence-detail", `/evidence/${EVIDENCE}`],
  ["08-matrix", `/matrix?brandId=${BRAND_ID}&includeMock=true`],
  ["09-snapshots", `/snapshots?brandId=${BRAND_ID}`],
  ["10-compare", `/compare?baseline=${BASELINE}&retest=${RETEST}`],
  ["11-report-top", `/reports/${REPORT}`],
  ["12-schedules", "/schedules"],
  ["13-settings", "/settings"],
  ["24-chat", "/chat"],
  ["25-analyses", "/analyses"],
  ["26-tasks", "/tasks"],
  ["27-competitors", "/competitors"],
];
for (const [name, url] of pages) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  await shot(name);
}

// Matrix table section
await page.goto(`${BASE}/matrix?brandId=${BRAND_ID}&includeMock=true`, { waitUntil: "networkidle" });
await page.getByText("按类别分组", { exact: false }).first().scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, 520));
await shot("08b-matrix-table");

// Task results tab
await page.goto(`${BASE}/search-lab/${RETEST}`, { waitUntil: "networkidle" });
await page.getByRole("tab", { name: /搜索结果/ }).click();
await shot("14-task-results");

// Matrix cell dialog
await page.goto(`${BASE}/matrix?brandId=${BRAND_ID}&includeMock=true`, { waitUntil: "networkidle" });
const cell = page.getByRole("button", { name: /已发现|本次未发现/ }).first();
if (await cell.count()) {
  await cell.click();
  await page.waitForTimeout(500);
  await shot("15-matrix-cell");
  await page.keyboard.press("Escape");
}

// Compare tabs
await page.goto(`${BASE}/compare?baseline=${BASELINE}&retest=${RETEST}`, { waitUntil: "networkidle" });
await page.getByRole("tab", { name: "页面变化" }).click();
await shot("16-compare-pages");
await page.getByRole("tab", { name: "波动分析" }).click();
await shot("17-compare-volatility");
await page.getByRole("tab", { name: "优化事件" }).click();
await shot("18-compare-events");

// Report sections
await page.goto(`${BASE}/reports/${REPORT}`, { waitUntil: "networkidle" });
await page.getByText("7. 品牌问题矩阵", { exact: false }).first().scrollIntoViewIfNeeded();
await shot("19-report-matrix");
await page.getByText("10. 代表性证据及来源链接", { exact: false }).first().scrollIntoViewIfNeeded();
await shot("20-report-evidence");
await page.getByText("13. 可执行的优化建议", { exact: false }).first().scrollIntoViewIfNeeded();
await shot("21-report-suggestions");

// Schedule create dialog
await page.goto(`${BASE}/schedules`, { waitUntil: "networkidle" });
const newSchedule = page.getByRole("button", { name: /新建排期/ }).first();
if (await newSchedule.count()) {
  await newSchedule.click();
  await page.waitForTimeout(500);
  await shot("22-schedule-dialog");
  await page.keyboard.press("Escape");
}

// End slide
await section("00c-section-2", "02", "采集与证据：结果是会消失的", "任务、原始结果、页面级证据分层保存，人工复核不覆盖原始数据。");
await section("00d-section-3", "03", "矩阵与快照：一眼看到缺口", "问题 × 品牌/竞品，失败与空结果有独立状态，可下钻到证据。");
await section("00e-section-4", "04", "复测与比较：把两轮放在一起", "共同可比问题、页面增减、数据质量与波动观察。");
await section("00f-section-5", "05", "报告与自动化：让结论可复核", "证据中心报告、多格式导出，以及外部调度驱动的定时采集。");

await shootHtml("28-architecture", archSlide1());
await shootHtml("29-data-layers", archSlide2());

await page.setContent(titleSlide({
  kicker: "从看见，到可复核",
  title: "让每一个结论，<span class=\"accent\">都能回到证据</span>",
  subtitle: "真实数据优先 · 指标可以复算 · 历史可以比较 · 结论不过度承诺",
  points: ["搜索证据", "品牌矩阵", "复测对比", "报告导出", "定时监测"],
}));
await shot("23-end");

console.log("ERRORS", errors);
await browser.close();
