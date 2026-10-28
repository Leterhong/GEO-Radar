/** 真实数据截图：设置(已连接) / 任务详情 / 证据库 / 品牌可见度 / GEO 分析 / 报告 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = "http://localhost:3100";
const OUT = "docs/assets";
mkdirSync(OUT, { recursive: true });
const ids = JSON.parse(readFileSync("docs/case-study-ids.json", "utf8"));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

// 登录
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
const EMAIL = process.env.CASE_EMAIL;
const PASSWORD = process.env.CASE_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("请设置 CASE_EMAIL / CASE_PASSWORD 环境变量后重试");
  process.exit(2);
}
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL("**/dashboard", { timeout: 25000 }).catch(() => undefined);
await page.waitForTimeout(1200);

// 1) 设置页：元宝搜索已连接
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/shot-settings-connected.png` });

// 2) 搜索任务详情
await page.goto(`${BASE}/search-lab/${ids.taskId}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1100);
await page.screenshot({ path: `${OUT}/shot-task-detail.png` });

// 3) 证据库
await page.goto(`${BASE}/evidence`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1100);
await page.screenshot({ path: `${OUT}/shot-evidence.png` });

// 4) 品牌可见度
await page.goto(`${BASE}/visibility?brandId=${ids.brandId}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/shot-visibility.png`, fullPage: true });

// 5) GEO 分析
await page.goto(`${BASE}/analyses`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(700);
await page.getByText("10 月 AI 搜索助手可见度复盘").first().click();
await page.waitForTimeout(1400);
await page.screenshot({ path: `${OUT}/shot-analysis.png`, fullPage: true });

// 6) 分析报告
await page.goto(`${BASE}/reports/${ids.reportId}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/shot-report.png`, fullPage: true });

console.log(JSON.stringify({ ok: true, errors }, null, 2));
await browser.close();
