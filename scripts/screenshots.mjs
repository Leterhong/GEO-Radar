/**
 * 全站截图脚本（视觉验收用）。
 * 用法: node scripts/screenshots.mjs
 * 会注册一个临时账号并登录，逐页截图到 .pgdata/shots/。
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";

const BASE = "http://localhost:3100";
const OUT = ".pgdata/shots";
mkdirSync(OUT, { recursive: true });

const email = `shot-${Date.now()}@georadar.test`;
const password = "ShotTest1234";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();

// 1) 登录页（未登录状态）
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/01-login.png`, fullPage: false });

// 2) 注册页
await page.goto(`${BASE}/register`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/02-register.png` });

// 3) 注册账号 → 进入完善品牌
await page.fill("#name", "视觉验收");
await page.fill("#email", email);
await page.fill("#password", password);
await page.fill("#confirm", password);
await page.check('input[type="checkbox"]');
await page.click('button[type="submit"]');
await page.waitForURL("**/onboarding", { timeout: 20000 }).catch(() => undefined);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/03-onboarding.png` });

// 4) 提交品牌 → 首页
await page.fill("#brand", "元宝");
await page.fill("#website", "https://yuanbao.tencent.com");
await page.fill("#desc", "AI 助手与搜索产品，用于视觉验收演示。");
await page.click('button[type="submit"]');
await page.waitForURL("**/dashboard", { timeout: 25000 }).catch(() => undefined);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/04-dashboard-empty.png` });

const pages = [
  ["05-chat", "/chat"],
  ["06-questions", "/questions"],
  ["07-brands", "/brands"],
  ["08-search-lab", "/search-lab"],
  ["09-visibility", "/visibility"],
  ["10-competitors", "/competitors"],
  ["11-evidence", "/evidence"],
  ["12-optimization", "/optimization"],
  ["13-experiments", "/experiments"],
  ["14-settings", "/settings"],
  ["15-wallboard", "/dashboard-tv"],
];

for (const [name, path] of pages) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

// 16) 创建一个模拟任务，让总览/证据页有数据
const api = context.request;
await api.post(`${BASE}/api/questions`, { data: { questionSetId: "", text: "占位" } }).catch(() => undefined);

// 移动端视图
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/16-mobile-dashboard.png` });
await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/17-mobile-chat.png` });

// 控制台错误采集
const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
console.log(JSON.stringify({ ok: true, shots: OUT, consoleErrors: errors }, null, 2));

await browser.close();
