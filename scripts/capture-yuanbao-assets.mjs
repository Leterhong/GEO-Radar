import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

for (const line of fs.readFileSync(path.resolve(".env.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const BASE = "http://127.0.0.1:3000";
const OUT = path.resolve("docs/assets/video/yuanbao-screens");
fs.mkdirSync(OUT, { recursive: true });
const WS = "cmvroabkw008eoeozers3995t";
const USER = "cmvroabjl008coeoz2r2dsiyn";
const BRAND = "cmvrogw69000bmrhmnt55fgem";
const BASELINE = "cmvrogwbb0015mrhm4rmw10f4";
const RETEST = "cmvrwthvh0001pgf9ngdzj9eo";
const REPORT = "cmvrwtt7s00cha566oda4rgz3";
const EVIDENCE = "cmvrwtrry002fa5660syatsrs";

const prisma = new PrismaClient();
const token = randomBytes(32).toString("hex");
const tokenHash = createHash("sha256").update(`${token}:${process.env.AUTH_SECRET}`).digest("hex");
await prisma.session.create({ data: { tokenHash, userId: USER, expiresAt: new Date(Date.now() + 86400000) } });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1.5 });
await context.addCookies([
  { name: "georadar_session", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
  { name: "georadar_workspace", value: WS, domain: "127.0.0.1", path: "/", sameSite: "Lax" },
]);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("Failed to fetch RSC payload")) errors.push(m.text());
});

async function shot(name) {
  await page.waitForTimeout(650);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log("shot", name, fs.statSync(file).size);
}

function titleSlide(title, subtitle, kicker, points = []) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;width:1920px;height:1080px;overflow:hidden;font-family:"Microsoft YaHei","PingFang SC",sans-serif;
    color:#0f1f33;background:radial-gradient(circle at 78% 18%,rgba(45,212,191,.18),transparent 38%),
      radial-gradient(circle at 16% 84%,rgba(59,130,246,.16),transparent 42%),
      linear-gradient(135deg,#f7fbff,#f3f8f5 52%,#eef6ff);padding:108px 120px;display:flex;flex-direction:column;justify-content:center;position:relative}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(15,31,51,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(15,31,51,.035) 1px,transparent 1px);background-size:64px 64px;mask-image:linear-gradient(120deg,rgba(0,0,0,.7),transparent 75%)}
  .brand{display:flex;align-items:center;gap:18px;margin-bottom:42px;position:relative}
  .logo{width:54px;height:54px;border-radius:16px;background:linear-gradient(135deg,#2563eb,#14b8a6);box-shadow:0 16px 40px rgba(37,99,235,.22);display:flex;align-items:center;justify-content:center;color:#fff;font-size:26px;font-weight:700}
  .brand b{font-size:23px;letter-spacing:.5px}
  .kicker{font-size:19px;letter-spacing:4px;color:#2563eb;font-weight:700;margin-bottom:18px;position:relative}
  h1{font-size:76px;line-height:1.14;letter-spacing:-2px;margin:0 0 26px;max-width:1500px;position:relative}
  .sub{font-size:29px;line-height:1.55;color:#41556b;max-width:1180px;position:relative}
  .accent{color:#0f766e}
  .points{display:flex;gap:16px;margin-top:50px;flex-wrap:wrap;position:relative}
  .point{padding:15px 21px;border-radius:999px;border:1px solid rgba(15,31,51,.12);background:rgba(255,255,255,.74);font-size:18px;color:#334b63}
  .meta{position:absolute;bottom:62px;left:120px;font-size:16px;color:#718096;letter-spacing:1px}
  .orb{position:absolute;border-radius:50%;filter:blur(2px);opacity:.5}
  .o1{width:340px;height:340px;right:110px;top:100px;background:radial-gradient(circle,#5eead4,transparent 66%)}
  .o2{width:260px;height:260px;right:290px;bottom:80px;background:radial-gradient(circle,#93c5fd,transparent 66%)}
  </style></head><body><div class="grid"></div><div class="orb o1"></div><div class="orb o2"></div>
  <div class="brand"><div class="logo">G</div><b>GEO Radar</b></div><div class="kicker">${kicker}</div><h1>${title}</h1><div class="sub">${subtitle}</div>
  ${points.length ? `<div class="points">${points.map((p) => `<div class="point">${p}</div>`).join("")}</div>` : ""}
  <div class="meta">元宝搜索开发者征文大赛 · 实战演示</div></body></html>`;
}

function sectionSlide(num, title, subtitle) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;width:1920px;height:1080px;overflow:hidden;font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#eaf6f4;
    background:radial-gradient(circle at 82% 16%,rgba(45,212,191,.24),transparent 36%),radial-gradient(circle at 18% 86%,rgba(37,99,235,.26),transparent 42%),linear-gradient(135deg,#071827,#0c2437 55%,#102f3e);
    padding:110px 120px;display:flex;flex-direction:column;justify-content:center;position:relative}
  .num{font-size:220px;line-height:1;font-weight:800;letter-spacing:-10px;color:rgba(94,234,212,.16);position:absolute;right:105px;top:75px}
  .kicker{font-size:18px;letter-spacing:6px;color:#5eead4;margin-bottom:22px}.line{width:120px;height:4px;background:linear-gradient(90deg,#5eead4,#3b82f6);border-radius:9px;margin-bottom:30px}
  h2{font-size:72px;line-height:1.15;margin:0 0 24px;letter-spacing:-1px}p{font-size:27px;line-height:1.6;color:#a9c4ce;max-width:1150px;margin:0}
  .meta{position:absolute;bottom:64px;left:120px;font-size:16px;color:#6f8b98;letter-spacing:2px}
  </style></head><body><div class="num">${num}</div><div class="kicker">元宝搜索 · 实战演示</div><div class="line"></div><h2>${title}</h2><p>${subtitle}</p><div class="meta">${num} / 05</div></body></html>`;
}

function capabilitySlide() {
  const cards = [
    ["大模型友好", "结构化网页结果：标题、URL、摘要、站点，减少二次清洗"],
    ["毫秒级响应", "本次 10 个问题，单请求实测 165–385ms"],
    ["分钟级更新", "适合持续监测、复测与时效性内容追踪"],
    ["海量资源库", "全网内容 + 腾讯内容生态，本次 98 条结果"],
  ];
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;width:1920px;height:1080px;overflow:hidden;font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#eaf6f4;
    background:radial-gradient(circle at 84% 12%,rgba(45,212,191,.22),transparent 36%),radial-gradient(circle at 12% 90%,rgba(37,99,235,.24),transparent 40%),linear-gradient(135deg,#071827,#0b2437 58%,#102f3e);padding:70px 92px;display:flex;flex-direction:column;justify-content:center}
  .kicker{font-size:16px;letter-spacing:5px;color:#5eead4;margin-bottom:12px}h1{font-size:54px;margin:0 0 10px;letter-spacing:-1px}
  .sub{font-size:20px;color:#9bb7c3;margin-bottom:28px}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
  .card{padding:22px 20px;border-radius:18px;border:1px solid rgba(148,211,220,.2);background:rgba(255,255,255,.04);min-height:190px}
  .card b{display:block;font-size:22px;margin-bottom:12px;color:#fff}.card span{font-size:15px;line-height:1.65;color:#9bb7c3}
  .flow{display:flex;align-items:center;gap:12px;margin-top:24px;padding:18px 20px;border-radius:16px;border:1px solid rgba(94,234,212,.25);background:rgba(94,234,212,.06)}
  .node{padding:10px 14px;border-radius:10px;background:rgba(7,24,39,.6);border:1px solid rgba(148,211,220,.2);font-size:16px;white-space:nowrap}
  .node b{display:block;font-size:17px;margin-bottom:3px}.node small{font-size:12px;color:#8daab6}.arrow{color:#5eead4;font-size:22px}
  .note{margin-top:18px;font-size:15px;color:#8daab6;line-height:1.6}
  </style></head><body><div class="kicker">YUANBAO SEARCHPRO / CORE</div><h1>元宝搜索：真实网页结果进入平台的第一站</h1>
  <div class="sub">不是让模型自由发挥，而是拿到可核对、可追溯的网页结果，再由应用做确定性分析。</div>
  <div class="cards">${cards.map(([a, b]) => `<div class="card"><b>${a}</b><span>${b}</span></div>`).join("")}</div>
  <div class="flow"><div class="node"><b>Query + count</b><small>固定问题、请求条数</small></div><div class="arrow">→</div><div class="node"><b>POST /SearchPro</b><small>Bearer 鉴权</small></div><div class="arrow">→</div><div class="node"><b>Pages + RequestId</b><small>标题 / URL / 摘要 / 站点</small></div><div class="arrow">→</div><div class="node"><b>RawSearchResponse</b><small>原始响应落库</small></div><div class="arrow">→</div><div class="node"><b>Evidence</b><small>页面级证据</small></div></div>
  <div class="note">本次真实样本：10 个问题 · 10 次请求 · 98 条结果 · 18 个品牌相关去重页面；耗时口径为单请求 durationMs，不代表所有网络条件。</div>
  </body></html>`;
}

function architectureSlide() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;width:1920px;height:1080px;overflow:hidden;font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#eaf6f4;
    background:radial-gradient(circle at 84% 10%,rgba(45,212,191,.18),transparent 34%),radial-gradient(circle at 12% 92%,rgba(37,99,235,.2),transparent 38%),linear-gradient(135deg,#071827,#0b2437 58%,#102f3e);padding:70px 92px;display:flex;flex-direction:column;justify-content:center}
  .kicker{font-size:16px;letter-spacing:5px;color:#5eead4;margin-bottom:10px}h1{font-size:52px;margin:0 0 8px}.sub{font-size:19px;color:#9bb7c3;margin-bottom:24px}
  .band{display:grid;grid-template-columns:150px 1fr;gap:18px;align-items:center;margin-top:13px;padding:15px 20px;border:1px solid rgba(148,211,220,.18);border-radius:17px;background:rgba(255,255,255,.035)}
  .label{font-size:14px;color:#5eead4;letter-spacing:2px;font-weight:700}.flow{display:flex;align-items:center;gap:11px}
  .node{padding:10px 14px;border-radius:11px;border:1px solid rgba(148,211,220,.24);background:rgba(7,24,39,.55);font-size:16px;white-space:nowrap}
  .node b{display:block;font-size:17px;margin-bottom:3px;color:#fff}.node small{font-size:11px;color:#8daab6}.arrow{font-size:22px;color:#5eead4}
  .yuanbao{border-color:rgba(94,234,212,.7);background:rgba(94,234,212,.12);box-shadow:0 0 0 1px rgba(94,234,212,.18) inset}
  .wide{flex:1;text-align:center}.muted{font-size:12px;color:#7e9aa7;margin-left:8px}
  </style></head><body><div class="kicker">ARCHITECTURE / 01</div><h1>元宝搜索，是唯一真实检索入口</h1><div class="sub">接入、执行、证据、快照、报告彼此解耦；所有数据按 workspaceId 隔离。</div>
  <div class="band"><div class="label">外部检索</div><div class="flow"><div class="node yuanbao"><b>元宝搜索 SearchPro</b><small>Query → Pages + RequestId</small></div><div class="arrow">→</div><div class="node"><b>Search Execution</b><small>请求封装 · 重试 · 超时 · 取消</small></div><div class="arrow">→</div><div class="node"><b>Evidence Analysis</b><small>URL 规范化 · 页面分类 · 品牌匹配</small></div></div></div>
  <div class="band"><div class="label">接入与鉴权</div><div class="flow"><div class="node wide"><b>Next.js App Router</b><small>页面 · API Routes · Server Components</small></div><div class="arrow">→</div><div class="node wide"><b>withAuth / workspaceId</b><small>会话校验 · 工作空间隔离 · 权限</small></div></div></div>
  <div class="band"><div class="label">领域与数据</div><div class="flow"><div class="node wide"><b>Matrix / Snapshot / Comparison / Report / Schedule</b><small>矩阵 · 快照 · 两轮比较 · 报告 · 排期</small></div><div class="arrow">→</div><div class="node wide"><b>PostgreSQL + Prisma</b><small>RawSearchResponse · Evidence · Snapshot · Report</small></div></div></div>
  <div class="band"><div class="label">外部调度</div><div class="flow"><div class="node"><b>cron / scheduler</b><small>独立进程</small></div><div class="arrow">→</div><div class="node"><b>POST /api/schedules/tick</b><small>CRON_SECRET · 幂等创建</small></div><div class="arrow">→</div><div class="node"><b>ScheduleRun</b><small>失败保留 · 不补假数据</small></div></div></div>
  </body></html>`;
}

function dataSlide() {
  const rows = [
    ["SOURCE", "元宝搜索 SearchPro", "Query → Pages / RequestId；真实网页结果", "外部"],
    ["原始层", "RawSearchResponse", "完整 JSON · RequestId · 采集时间", "不可变"],
    ["结果层", "SearchResult", "标题 · URL · 域名 · 摘要 · 位置", "url-norm-v1"],
    ["证据层", "Evidence", "页面类型 · 来源角色 · 匹配依据 · 人工复核", "evidence-v2"],
    ["快照层", "AnalysisSnapshot", "COLLECTION / RECOMPUTE · 指标分子分母", "snapshot-v1"],
  ];
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;width:1920px;height:1080px;overflow:hidden;font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#eaf6f4;
    background:radial-gradient(circle at 82% 14%,rgba(45,212,191,.2),transparent 34%),radial-gradient(circle at 16% 88%,rgba(37,99,235,.22),transparent 40%),linear-gradient(135deg,#071827,#0b2437 58%,#102f3e);padding:70px 92px;display:flex;flex-direction:column;justify-content:center}
  .kicker{font-size:16px;letter-spacing:5px;color:#5eead4;margin-bottom:10px}h1{font-size:52px;margin:0 0 8px}.sub{font-size:19px;color:#9bb7c3;margin-bottom:22px}
  .rows{display:flex;flex-direction:column;gap:11px}.row{display:grid;grid-template-columns:130px 1fr 220px;gap:18px;align-items:center;padding:14px 20px;border:1px solid rgba(148,211,220,.18);border-radius:16px;background:rgba(255,255,255,.035)}
  .layer{font-size:14px;color:#5eead4;letter-spacing:2px;font-weight:700}.name b{font-size:22px;display:block;margin-bottom:3px}.name small{font-size:13px;color:#8daab6}
  .tag{font-size:12px;color:#b8d7df;text-align:right;border:1px dashed rgba(148,211,220,.28);border-radius:999px;padding:6px 11px;justify-self:end}
  .outs{display:flex;gap:12px;margin-top:18px;margin-left:130px}.out{padding:10px 16px;border-radius:11px;background:rgba(94,234,212,.09);border:1px solid rgba(94,234,212,.25);font-size:15px}
  .note{margin-top:20px;font-size:15px;color:#9bb7c3;line-height:1.6;border-left:3px solid #5eead4;padding-left:14px}
  </style></head><body><div class="kicker">ARCHITECTURE / 02</div><h1>数据分层：原始不可变，分析可重算</h1><div class="sub">越往上越接近业务结论；每一层都有规则版本，报告可以回到证据。</div>
  <div class="rows">${rows.map((r) => `<div class="row"><div class="layer">${r[0]}</div><div class="name"><b>${r[1]}</b><small>${r[2]}</small></div><div class="tag">${r[3]}</div></div>`).join("")}</div>
  <div class="outs"><div class="out">品牌问题矩阵</div><div class="out">两轮比较</div><div class="out">证据中心报告</div></div>
  <div class="note">元宝搜索只负责返回真实网页结果；平台不把搜索结果当成“最终答案”，而是把它变成可复核的页面级证据。</div>
  </body></html>`;
}

function completenessSlide() {
  const stages = ["品牌配置", "固定问题集", "元宝真实采集", "页面级证据", "人工复核", "品牌问题矩阵", "不可变快照", "两轮复测", "对比与波动", "报告与导出", "定时采集"];
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;width:1920px;height:1080px;overflow:hidden;font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#0f1f33;
    background:radial-gradient(circle at 80% 16%,rgba(45,212,191,.2),transparent 36%),radial-gradient(circle at 16% 86%,rgba(59,130,246,.16),transparent 42%),linear-gradient(135deg,#f7fbff,#f2f8f6 55%,#eef6ff);padding:88px 110px;display:flex;flex-direction:column;justify-content:center}
  .kicker{font-size:17px;letter-spacing:5px;color:#0f766e;font-weight:700;margin-bottom:14px}h1{font-size:56px;margin:0 0 12px;letter-spacing:-1px}.sub{font-size:21px;color:#41556b;margin-bottom:30px}
  .chain{display:flex;flex-wrap:wrap;gap:11px}.step{padding:15px 19px;border-radius:14px;background:rgba(255,255,255,.8);border:1px solid rgba(15,31,51,.1);font-size:17px;color:#1f3b52;box-shadow:0 6px 18px rgba(15,31,51,.04)}
  .step:nth-child(3){background:#0f766e;color:#fff;border-color:#0f766e}.step:nth-child(10){background:#1d4ed8;color:#fff;border-color:#1d4ed8}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:30px}.stat{padding:18px 20px;border-radius:16px;background:rgba(255,255,255,.78);border:1px solid rgba(15,31,51,.08)}
  .stat b{display:block;font-size:34px;color:#0f766e;margin-bottom:4px}.stat span{font-size:14px;color:#5b7185}
  .note{margin-top:24px;font-size:16px;color:#41556b;line-height:1.7;border-left:3px solid #14b8a6;padding-left:16px}
  </style></head><body><div class="kicker">PLATFORM COMPLETENESS</div><h1>不是页面拼图，是一条完整证据链</h1><div class="sub">元宝搜索负责“查得到”；平台负责“存得下、算得清、复得盘”。</div>
  <div class="chain">${stages.map((s) => `<div class="step">${s}</div>`).join("")}</div>
  <div class="stats"><div class="stat"><b>10</b><span>固定问题</span></div><div class="stat"><b>2</b><span>真实复测轮次</span></div><div class="stat"><b>198</b><span>两轮结果条数</span></div><div class="stat"><b>14</b><span>报告章节</span></div></div>
  <div class="note">品牌、问题、任务、证据、快照、比较、报告、排期都有独立数据结构和规则版本；失败、空结果、未发现不混为一谈。</div>
  </body></html>`;
}

async function setHtml(name, html) {
  await page.setContent(html);
  await shot(name);
}

await setHtml("00-title", titleSlide(
  "接入元宝搜索，<span class=\"accent\">把搜索结果变成证据</span>",
  "这次参加元宝搜索开发者征文大赛，我用 SearchPro 做了一个 GEO 品牌可见度诊断平台：不是宣传平台，而是展示元宝搜索如何解决一个具体问题。",
  "元宝搜索 · 真实网页结果",
  ["真实调用", "页面级证据", "两轮复测", "可复核报告"]
));
await setHtml("00b-section-1", sectionSlide("01", "需求：品牌在 AI 搜索里到底在不在场", "用户问 AI 哪款产品好用，答案引用的可能不是官网，而是别人写的盘点。品牌需要看到真实搜索结果。"));
await setHtml("00c-yuanbao", capabilitySlide());
await setHtml("00d-section-2", sectionSlide("02", "接入：元宝搜索负责真实检索", "SearchPro 返回网页结果和 RequestId；平台负责鉴权、重试、超时、错误分类和原始响应落库。"));

// Real workspace pages
const pages = [
  ["01-settings", "/settings"],
  ["02-brands", "/brands"],
  ["03-questions", "/questions"],
  ["04-search-lab", "/search-lab"],
  ["05-task-items", `/search-lab/${RETEST}`],
  ["06-evidence-detail", `/evidence/${EVIDENCE}`],
  ["07-matrix", `/matrix?brandId=${BRAND}&includeMock=false`],
  ["08-snapshots", `/snapshots?brandId=${BRAND}`],
  ["09-compare", `/compare?baseline=${BASELINE}&retest=${RETEST}`],
  ["10-report-top", `/reports/${REPORT}`],
];
for (const [name, url] of pages) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  await shot(name);
}

// Task results tab
await page.goto(`${BASE}/search-lab/${RETEST}`, { waitUntil: "networkidle" });
await page.getByRole("tab", { name: /搜索结果/ }).click();
await shot("11-task-results");

// Matrix cell
await page.goto(`${BASE}/matrix?brandId=${BRAND}&includeMock=false`, { waitUntil: "networkidle" });
const cell = page.getByRole("button", { name: /已发现|本次未发现/ }).first();
if (await cell.count()) {
  await cell.click();
  await page.waitForTimeout(500);
  await shot("12-matrix-cell");
  await page.keyboard.press("Escape");
}

// Compare tabs
await page.goto(`${BASE}/compare?baseline=${BASELINE}&retest=${RETEST}`, { waitUntil: "networkidle" });
await page.getByRole("tab", { name: "页面变化" }).click();
await shot("13-compare-pages");
await page.getByRole("tab", { name: "波动分析" }).click();
await shot("14-compare-volatility");

// Report sections
await page.goto(`${BASE}/reports/${REPORT}`, { waitUntil: "networkidle" });
await page.getByText("7. 品牌问题矩阵", { exact: false }).first().scrollIntoViewIfNeeded();
await shot("15-report-matrix");
await page.getByText("10. 代表性证据及来源链接", { exact: false }).first().scrollIntoViewIfNeeded();
await shot("16-report-evidence");
await page.getByText("13. 可执行的优化建议", { exact: false }).first().scrollIntoViewIfNeeded();
await shot("17-report-suggestions");

await setHtml("18-completeness", completenessSlide());
await setHtml("19-architecture", architectureSlide());
await setHtml("20-data-layers", dataSlide());
await setHtml("21-end", titleSlide(
  "元宝搜索负责查得到，<span class=\"accent\">平台负责说得清</span>",
  "从一条真实网页结果，到可追溯的页面证据、品牌问题矩阵、两轮复测和可复核报告。",
  "完整闭环",
  ["真实调用", "证据可追溯", "指标可复算", "报告可复核"]
));

console.log("ERRORS", errors);
console.log("SESSION", tokenHash);
await browser.close();
// Keep the session for re-capture? Delete after screenshots; screenshots are static.
await prisma.session.deleteMany({ where: { tokenHash } });
await prisma.$disconnect();
