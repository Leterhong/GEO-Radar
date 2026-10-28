/**
 * 浏览器端 UI 验证（Playwright Chromium）。
 * 使用 MOCK 数据 + 测试专用 ALLOW_MOCK_REPORTS 生成一张对比报告，然后逐页截图与断言。
 *
 * 运行：node scripts/ui-verify.mjs
 * 前置：服务运行在 BASE（默认 http://127.0.0.1:3100），并设置 ALLOW_MOCK_REPORTS=true。
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.UI_BASE ?? "http://127.0.0.1:3100";
const outDir = path.resolve("docs/assets/verification");
fs.mkdirSync(outDir, { recursive: true });

let cookieJar = new Map();
function cookieHeader() {
  return Array.from(cookieJar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
async function api(pathname, options = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(cookieHeader() ? { cookie: cookieHeader() } : {}),
      ...(options.headers ?? {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
    const pair = c.split(";")[0];
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (value === "") cookieJar.delete(name);
    else cookieJar.set(name, value);
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json };
}
async function pollTask(taskId) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const res = await api(`/api/search-tasks/${taskId}`);
    const task = res.json?.data?.task;
    if (task && !["QUEUED", "RUNNING"].includes(task.status)) return task;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

let failures = 0;
function check(name, cond, detail = "") {
  if (!cond) failures += 1;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}${detail ? " — " + detail : ""}`);
}

async function main() {
  const email = `ui-${Date.now()}@georadar.test`;
  const password = "UiTest12345";
  const reg = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "UI 验证账号", agreeTerms: true }),
  });
  if (reg.status !== 200) throw new Error("注册失败：" + JSON.stringify(reg.json));
  const brand = await api("/api/brands", {
    method: "POST",
    body: JSON.stringify({
      name: "UI 验收品牌",
      aliases: ["UI验收"],
      websiteUrl: "https://ui-acceptance.example.com",
      officialSubdomains: ["docs.ui-acceptance.example.com"],
      products: ["UI 验收助手"],
    }),
  });
  const brandId = brand.json.data.id;
  await api("/api/competitors", {
    method: "POST",
    body: JSON.stringify({ brandId, name: "UI 竞品", aliases: ["UI竞品"], websiteUrl: "https://ui-rival.example.com" }),
  });
  const set = await api("/api/question-sets", { method: "POST", body: JSON.stringify({ name: "UI 验收问题集" }) });
  const questionSetId = set.json.data.id;
  const questions = [
    { text: "UI验收 是什么品牌", category: "品牌认知" },
    { text: "UI验收 助手有哪些功能", category: "产品功能" },
    { text: "UI验收 和 UI 竞品 哪个好", category: "产品对比" },
    { text: "UI验收 值得购买吗", category: "购买决策" },
  ];
  for (const q of questions) {
    await api("/api/questions", { method: "POST", body: JSON.stringify({ questionSetId, ...q }) });
  }
  const task = await api("/api/search-tasks", {
    method: "POST",
    body: JSON.stringify({ name: "UI 验收基线", brandId, questionSetId, executionMode: "MOCK", maxResults: 5 }),
  });
  const baselineTaskId = task.json.data.id;
  await api(`/api/search-tasks/${baselineTaskId}/start`, { method: "POST" });
  const baseline = await pollTask(baselineTaskId);
  check("基线任务完成", baseline?.status === "COMPLETED");

  const retest = await api(`/api/search-tasks/${baselineTaskId}/retest`, {
    method: "POST",
    body: JSON.stringify({ name: "UI 验收复测" }),
  });
  const retestTaskId = retest.json.data.task.id;
  await api(`/api/search-tasks/${retestTaskId}/start`, { method: "POST" });
  const retestDone = await pollTask(retestTaskId);
  check("复测任务完成", retestDone?.status === "COMPLETED");

  const report = await api("/api/reports", {
    method: "POST",
    body: JSON.stringify({ taskId: retestTaskId, compareTaskId: baselineTaskId, title: "UI 验收对比报告" }),
  });
  const reportId = report.json?.data?.id;
  check("测试报告生成", Boolean(reportId), JSON.stringify(report.json?.error ?? {}));

  const matrix = await api(`/api/matrix?brandId=${brandId}&includeMock=true`);
  const evidenceId = matrix.json?.data?.dataset?.evidence?.[0]?.id;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(`${page.url()} :: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // 页面跳转时 Next 会中止尚未完成的 RSC 预取，属于浏览器导航取消而非应用错误
    if (text.includes("Failed to fetch RSC payload")) return;
    pageErrors.push(`console: ${text}`);
  });

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([page.waitForURL("**/dashboard", { timeout: 20_000 }), page.locator('button[type="submit"]').click()]);
  check("浏览器登录成功进入工作台", page.url().includes("/dashboard"));

  async function capture(name, url, waitForTexts) {
    await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
    for (const text of waitForTexts) {
      try {
        await page.getByText(text, { exact: false }).first().waitFor({ timeout: 15_000 });
      } catch {
        check(`${name} 页面包含「${text}」`, false, "等待超时");
        await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
        return;
      }
    }
    await page.waitForTimeout(500);
    const file = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    check(`${name} 截图完成`, fs.existsSync(file) && fs.statSync(file).size > 10_000, file);
  }

  await capture("matrix", `/matrix?brandId=${brandId}&includeMock=true`, ["品牌问题矩阵", "有效问题（分母）", "UI 验收品牌", "问题类别覆盖"]);
  // 点击一个矩阵单元格，验证下钻弹窗
  const cell = page.getByRole("button", { name: /已发现|本次未发现/ }).first();
  if (await cell.count()) {
    await cell.click();
    await page.waitForTimeout(400);
    const dialogVisible = await page.getByText("匹配依据", { exact: false }).first().isVisible().catch(() => false);
    check("矩阵单元格可打开证据下钻", dialogVisible);
    await page.screenshot({ path: path.join(outDir, "matrix-cell-dialog.png"), fullPage: true });
    await page.keyboard.press("Escape");
  } else {
    check("矩阵单元格可打开证据下钻", false, "未找到单元格");
  }

  await capture("evidence-detail", `/evidence/${evidenceId}`, ["原始搜索结果（不可修改）", "页面级分析结果", "人工复核", "复核记录"]);
  await capture("compare", `/compare?baseline=${baselineTaskId}&retest=${retestTaskId}`, ["核心指标变化", "共同可比问题", "对比条件", "结论限制"]);
  await capture("report", `/reports/${reportId}`, ["品牌问题矩阵", "代表性证据及来源链接", "可执行的优化建议", "结果波动与数据限制"]);
  await capture("schedules", "/schedules", ["定时采集排期", "调度方式", "新建排期"]);
  await capture("snapshots", "/snapshots", ["历史快照", "采集快照"]);
  await capture("task-detail", `/search-lab/${retestTaskId}`, ["问题执行明细", "分析快照", "搜索结果"]);
  await capture("questions", "/questions", ["问题集", "版本", "复制"]);
  await capture("brands", "/brands", ["品牌管理", "官方子域"]);

  check("页面无未捕获 JS 错误", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

  await browser.close();
  console.log(failures === 0 ? "\nALL UI CHECKS PASSED" : `\n${failures} UI CHECK(S) FAILED`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("ui verify crashed:", error);
  process.exitCode = 1;
});
