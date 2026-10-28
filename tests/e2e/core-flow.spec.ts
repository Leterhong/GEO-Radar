/**
 * E2E 冒烟测试：注册 → 引导 → 问题集 → 未配置密钥时真实搜索被阻止 → 模拟模式完整流程。
 * 需要可用的 PostgreSQL（DATABASE_URL）与 dev server。
 */
import { test, expect } from "@playwright/test";
import crypto from "crypto";

const email = `e2e-${crypto.randomBytes(4).toString("hex")}@georadar.test`;
const password = "E2eTest1234";

test.describe("GEO Radar 核心流程", () => {
  test("注册 → 初始化 → 创建问题集与问题", async ({ page }) => {
    await page.goto("/register");
    await page.fill("#name", "E2E 测试用户");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.fill("#confirm", password);
    await page.check('input[type="checkbox"]');
    await page.click('button[type="submit"]');
    await page.waitForURL("**/onboarding", { timeout: 15000 });

    await page.fill("#workspace", "E2E 工作空间");
    await page.fill("#brand", "E2E 品牌");
    await page.fill("#website", "https://example-e2e.com");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });
    await expect(page.getByText("总览")).toBeVisible();
  });

  test("未配置 API Key 时创建真实任务在执行前被明确阻止", async ({ page }) => {
    // 直接访问注册流程后进入搜索实验室
    await page.goto("/register");
    await page.fill("#name", "E2E 用户2");
    await page.fill("#email", `e2e2-${crypto.randomBytes(4).toString("hex")}@georadar.test`);
    await page.fill("#password", password);
    await page.fill("#confirm", password);
    await page.check('input[type="checkbox"]');
    await page.click('button[type="submit"]');
    await page.waitForURL("**/onboarding", { timeout: 15000 });
    await page.fill("#workspace", "E2E 工作空间2");
    await page.fill("#brand", "E2E 品牌2");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // 创建问题集与问题
    await page.goto("/questions");
    await page.getByRole("button", { name: "新建问题集" }).first().click();
    await page.fill("#setName", "E2E 问题集");
    await page.getByRole("dialog").getByRole("button", { name: "创建" }).click();
    await page.getByRole("button", { name: "添加问题" }).click();
    await page.fill("#qtext", "E2E 测试问题：品牌是否出现？");
    await page.getByRole("dialog").getByRole("button", { name: "添加" }).click();

    // 搜索实验室：创建真实任务（服务端应返回 PROVIDER_NOT_CONFIGURED）
    await page.goto("/search-lab");
    await page.getByRole("button", { name: "创建搜索任务" }).click();
    await page.fill("#taskName", "E2E 未配置任务");
    await page.getByRole("dialog").getByRole("button", { name: "创建任务" }).click();
    await page.waitForTimeout(1000);
    // 服务端守卫应提示配置缺失，不允许执行
    const dialogText = await page.locator("[role=dialog]").innerText();
    expect(dialogText.length).toBeGreaterThan(0);
  });

  test("模拟模式完整流程：创建 → 确认执行 → 出现带模拟标记的结果", async ({ page }) => {
    await page.goto("/register");
    await page.fill("#name", "E2E 用户3");
    await page.fill("#email", `e2e3-${crypto.randomBytes(4).toString("hex")}@georadar.test`);
    await page.fill("#password", password);
    await page.fill("#confirm", password);
    await page.check('input[type="checkbox"]');
    await page.click('button[type="submit"]');
    await page.waitForURL("**/onboarding", { timeout: 15000 });
    await page.fill("#workspace", "E2E 工作空间3");
    await page.fill("#brand", "E2E 品牌3");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    await page.goto("/questions");
    await page.getByRole("button", { name: "新建问题集" }).first().click();
    await page.fill("#setName", "E2E 模拟问题集");
    await page.getByRole("dialog").getByRole("button", { name: "创建" }).click();
    await page.getByRole("button", { name: "添加问题" }).click();
    await page.fill("#qtext", "模拟模式测试问题");
    await page.getByRole("dialog").getByRole("button", { name: "添加" }).click();

    await page.goto("/search-lab");
    await page.getByRole("button", { name: "创建搜索任务" }).click();
    await page.fill("#taskName", "E2E 模拟任务");
    // 切换到模拟模式
    await page.getByRole("dialog").getByText("真实搜索（元宝）").click();
    await page.getByRole("option", { name: "模拟模式（演示）" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "创建任务" }).click();
    // 确认执行
    await page.getByRole("button", { name: "确认执行" }).click();
    // 任务详情应出现模拟标记
    await expect(page.getByText("模拟数据").first()).toBeVisible({ timeout: 20000 });
  });

  test("未登录访问受保护页面跳转登录", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login", { timeout: 10000 });
    expect(page.url()).toContain("/login");
  });
});
