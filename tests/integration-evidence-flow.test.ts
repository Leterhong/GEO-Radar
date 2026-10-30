import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * 集成测试：真实数据库 + Mock 供应商（不产生外部 API 调用）。
 * 覆盖：品牌/问题集/采集任务/证据/矩阵/快照/复测/比较/报告/定时采集。
 *
 * 前置条件：DATABASE_URL 可用且已执行迁移。
 * 若数据库不可用，本测试自动 skip（并在控制台说明），不会伪造通过。
 */

// 在导入 Prisma/服务前加载 .env.local（vitest 不会自动加载 Next 的环境文件）
function loadEnvLocal() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    const key = match[1] as string;
    let value = (match[2] ?? "").trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvLocal();
process.env.ALLOW_MOCK_REPORTS = "true";

let dbAvailable = false;
try {
  const { prisma } = await import("@/server/db/client");
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch (error) {
  console.warn(
    "[integration] 数据库不可用，跳过集成测试：",
    error instanceof Error ? error.message.split("\n")[0] : error
  );
}

describe.skipIf(!dbAvailable)("集成：真实搜索证据链 → 矩阵 → 复测 → 比较 → 报告", () => {
  const suffix = randomUUID().slice(0, 8);
  let userId = "";
  let workspaceId = "";
  let brandId = "";
  let questionSetId = "";
  let baselineTaskId = "";
  let retestTaskId = "";

  beforeAll(async () => {
    const { prisma } = await import("@/server/db/client");
    const user = await prisma.user.create({
      data: { email: `integration-${suffix}@geo-radar.test`, passwordHash: "not-used", name: "集成测试用户" },
    });
    userId = user.id;
    const workspace = await prisma.workspace.create({
      data: { name: `集成测试空间 ${suffix}`, ownerId: user.id },
    });
    workspaceId = workspace.id;
    await prisma.workspaceMember.create({ data: { workspaceId, userId, role: "OWNER" } });
  });

  afterAll(async () => {
    const { prisma } = await import("@/server/db/client");
    try {
      if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } });
      if (userId) await prisma.user.delete({ where: { id: userId } });
    } catch (error) {
      console.warn("[integration] 清理测试数据失败：", error instanceof Error ? error.message : error);
    }
  });

  it("创建品牌、竞品与问题集版本", async () => {
    const { prisma } = await import("@/server/db/client");
    const { createInitialQuestionSetVersion } = await import("@/server/services/question-set-service");

    const brand = await prisma.brand.create({
      data: {
        workspaceId,
        name: "Acme 测试品牌",
        aliases: ["Acme"],
        websiteDomain: "acme.test",
        websiteUrl: "https://acme.test",
        officialSubdomains: ["docs.acme.test"],
        products: ["Acme Search"],
        productAliases: [],
        keywords: ["搜索"],
      },
    });
    brandId = brand.id;
    await prisma.competitor.create({
      data: { workspaceId, brandId, name: "Rival 测试", aliases: ["Rival"], websiteDomain: "rival.test" },
    });

    const created = await prisma.$transaction(async (tx) => {
      const set = await tx.questionSet.create({
        data: { workspaceId, name: "集成测试问题集", description: "覆盖品牌认知/产品功能/对比/购买", currentVersion: 1 },
      });
      const texts = [
        { text: "Acme 测试品牌是什么", category: "品牌认知" },
        { text: "Acme Search 有哪些功能", category: "产品功能" },
        { text: "Acme 测试品牌和 Rival 测试哪个好", category: "产品对比" },
        { text: "Acme 测试品牌值得购买吗", category: "购买决策" },
      ];
      const questions = [];
      for (const [index, item] of texts.entries()) {
        questions.push(
          await tx.question.create({
            data: { workspaceId, questionSetId: set.id, text: item.text, category: item.category, priority: 5 - index },
          })
        );
      }
      await createInitialQuestionSetVersion(tx, set, questions, userId);
      return set;
    });
    questionSetId = created.id;
    expect(brandId).not.toBe("");
    expect(questionSetId).not.toBe("");
  });

  it("创建并执行 Mock 采集任务，保存真实结构的结果与证据，并生成快照", async () => {
    const { prisma } = await import("@/server/db/client");
    const { createSearchTask, startSearchTask } = await import("@/server/services/search-execution");
    const { buildRoundDataset } = await import("@/server/services/matrix-service");

    const task = await createSearchTask(workspaceId, userId, {
      name: "集成测试第一轮",
      brandId,
      questionSetId,
      provider: "MOCK",
      executionMode: "MOCK",
      maxResults: 5,
    });
    baselineTaskId = task.id;
    expect(task.questionSetVersion).toBe(1);
    expect(task.totalItems).toBe(4);
    expect(task.brandSnapshot).toBeTruthy();

    const finished = await startSearchTask(task.id, workspaceId, userId);
    expect(finished?.status).toBe("COMPLETED");
    expect(finished?.successItems).toBe(4);
    expect(finished?.emptyItems).toBe(0);

    const evidence = await prisma.evidence.findMany({ where: { taskId: task.id } });
    expect(evidence.length).toBeGreaterThan(0);
    for (const row of evidence) {
      expect(row.isMock).toBe(true);
      expect(row.normalizedUrl).toBeTruthy();
      expect(row.pageType).not.toBe("UNKNOWN");
      expect(row.sourceRole).not.toBe("UNKNOWN");
      expect(row.ruleVersion).toBeTruthy();
    }
    // 原始搜索结果未被分析字段覆盖
    const rawResults = await prisma.searchResult.findMany({ where: { taskId: task.id } });
    expect(rawResults.length).toBe(evidence.length);

    const snapshots = await prisma.analysisSnapshot.findMany({ where: { taskId: task.id } });
    expect(snapshots.some((s) => s.kind === "COLLECTION")).toBe(true);

    const dataset = await buildRoundDataset(workspaceId, task.id);
    expect(dataset.questions).toHaveLength(4);
    expect(dataset.entities.some((e) => e.kind === "BRAND")).toBe(true);
    expect(dataset.entities.some((e) => e.kind === "COMPETITOR")).toBe(true);
    const brandMetric = dataset.metrics.find((m) => m.key === "brand_mention_question_rate");
    expect(brandMetric?.denominator).toBe(4);
    expect(brandMetric?.numerator).toBe(4); // mock 标题包含问题文本（含品牌别名）
    expect(dataset.pageTypeDistribution.length).toBeGreaterThan(0);

    const brandQuestion = dataset.questions[0];
    expect(brandQuestion?.cells.some((c) => c.state === "FOUND")).toBe(true);
  });

  it("品牌未配置官网时，官网覆盖率标记为不可计算（不是 0%）", async () => {
    const { prisma } = await import("@/server/db/client");
    const { buildRoundDataset } = await import("@/server/services/matrix-service");
    const brand = await prisma.brand.findUnique({ where: { id: brandId } });
    expect(brand).toBeTruthy();
    await prisma.brand.update({
      where: { id: brandId },
      data: { websiteDomain: null, websiteUrl: null, officialSubdomains: [] },
    });
    try {
      const dataset = await buildRoundDataset(workspaceId, baselineTaskId);
      const metric = dataset.metrics.find((m) => m.key === "official_site_coverage");
      expect(metric?.notConfigured).toBe(true);
      expect(metric?.value).toBeNull();
      expect(metric?.insufficient).toBe(true);
      expect(dataset.limitations.some((item) => item.includes("未配置官网"))).toBe(true);
    } finally {
      await prisma.brand.update({
        where: { id: brandId },
        data: {
          websiteDomain: brand!.websiteDomain,
          websiteUrl: brand!.websiteUrl,
          officialSubdomains: brand!.officialSubdomains,
        },
      });
    }
  });

  it("失败问题不计为「品牌未出现」", async () => {
    const { prisma } = await import("@/server/db/client");
    const { buildRoundDataset } = await import("@/server/services/matrix-service");
    const failedItem = await prisma.searchTaskItem.findFirst({
      where: { taskId: baselineTaskId },
      orderBy: { createdAt: "asc" },
    });
    expect(failedItem).toBeTruthy();
    await prisma.searchTaskItem.update({
      where: { id: failedItem!.id },
      data: { status: "FAILED", error: "模拟失败（集成测试）", errorCategory: "HTTP_ERROR", resultCount: 0 },
    });
    const dataset = await buildRoundDataset(workspaceId, baselineTaskId);
    const question = dataset.questions.find((q) => q.itemId === failedItem!.id);
    expect(question?.state).toBe("TASK_FAILED");
    const brandMetric = dataset.metrics.find((m) => m.key === "brand_mention_question_rate");
    expect(brandMetric?.denominator).toBe(3);
    expect(brandMetric?.sampleScope).toContain("失败");
    // 恢复，避免影响后续比较
    await prisma.searchTaskItem.update({
      where: { id: failedItem!.id },
      data: { status: "SUCCESS", error: null, errorCategory: null, resultCount: 5 },
    });
  });

  it("创建第二轮复测，不复用上一轮结果，并生成不可变快照", async () => {
    const { prisma } = await import("@/server/db/client");
    const { createRetestTask } = await import("@/server/services/retest-service");
    const { startSearchTask } = await import("@/server/services/search-execution");

    const retest = await createRetestTask(workspaceId, userId, baselineTaskId, { name: "集成测试第二轮" });
    retestTaskId = retest.id;
    expect(retest.baselineTaskId).toBe(baselineTaskId);
    expect(retest.id).not.toBe(baselineTaskId);
    const before = await prisma.evidence.count({ where: { taskId: retest.id } });
    expect(before).toBe(0); // 新任务创建时没有任何结果

    const finished = await startSearchTask(retest.id, workspaceId, userId);
    expect(finished?.status).toBe("COMPLETED");
    const after = await prisma.evidence.count({ where: { taskId: retest.id } });
    expect(after).toBeGreaterThan(0);
    const baselineEvidenceCount = await prisma.evidence.count({ where: { taskId: baselineTaskId } });
    expect(after).toBe(baselineEvidenceCount);
  });

  it("两轮比较：可比较、共同问题、页面变化与波动说明", async () => {
    const { compareTaskRounds } = await import("@/server/services/comparison-service");
    const comparison = await compareTaskRounds(workspaceId, baselineTaskId, retestTaskId);
    expect(comparison.comparable).toBe(true);
    expect(comparison.questions.totalCommon).toBe(4);
    expect(comparison.commonSubset.metrics).toHaveLength(3);
    expect(comparison.dataQuality.baselineFailedShare).toBe(0);
    expect(comparison.volatility.intervalLabel).toContain("不是置信区间");
    expect(comparison.disclaimer).toContain("不能声称");
    expect(comparison.pageDiff.persistedPages.length).toBeGreaterThan(0);
    expect(comparison.conditions.sameExecutionMode).toBe(true);
  });

  it("生成搜索证据报告并导出 Markdown/HTML/CSV", async () => {
    const { prisma } = await import("@/server/db/client");
    const {
      createCollectionReport,
      getCollectionSnapshot,
      renderCollectionHtml,
      renderCollectionMarkdown,
      renderCollectionEvidenceCsv,
      renderCollectionQuestionsCsv,
      renderCollectionMetricsCsv,
    } = await import("@/server/services/collection-report-service");

    const report = await createCollectionReport(workspaceId, userId, {
      taskId: retestTaskId,
      compareTaskId: baselineTaskId,
      title: "集成测试对比报告",
    });
    expect(report.kind).toBe("COMPARISON");
    const stored = await prisma.report.findUnique({ where: { id: report.id } });
    expect(stored).toBeTruthy();
    const snapshot = getCollectionSnapshot(stored!);
    expect(snapshot.schemaVersion).toBe("search-report-v1");
    expect(snapshot.collection.isMock).toBe(true);
    expect(snapshot.metrics.length).toBeGreaterThanOrEqual(3);
    expect(snapshot.suggestions.length).toBeGreaterThan(0);
    expect(snapshot.dataVersion.snapshotIds.length).toBeGreaterThan(0);

    const markdown = renderCollectionMarkdown(snapshot);
    expect(markdown).toContain("## 7. 品牌问题矩阵");
    expect(markdown).toContain("## 12. 结果波动与数据限制");
    expect(markdown).toContain("## 14. 报告生成时间与数据版本");
    expect(markdown).toContain(snapshot.dataVersion.reportedRuleVersion);

    const html = renderCollectionHtml(snapshot);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("品牌问题矩阵");
    expect(html).toContain("Acme 测试品牌");

    expect(renderCollectionMetricsCsv(snapshot)).toContain("brand_mention_question_rate");
    expect(renderCollectionQuestionsCsv(snapshot).split("\n").length).toBeGreaterThan(4);
    expect(renderCollectionEvidenceCsv(snapshot)).toContain("evidence_id");
  });

  it("定时采集：到期排期创建真实任务、推进下次时间并记录执行结果", async () => {
    const { prisma } = await import("@/server/db/client");
    const { createSchedule, runDueSchedules } = await import("@/server/services/schedule-service");

    const created = await createSchedule(workspaceId, userId, {
      name: "集成测试每日排期",
      brandId,
      questionSetId,
      frequency: "DAILY",
      timezone: "Asia/Shanghai",
      hour: 9,
      minute: 0,
      executionMode: "MOCK",
      confirmedCost: true,
      params: { maxResults: 5 },
    });
    expect(created.enabledCount).toBe(4);
    // 把下次执行时间改到过去，模拟到期（不等待真实时间）
    await prisma.schedule.update({
      where: { id: created.schedule.id },
      data: { nextRunAt: new Date(Date.now() - 60_000) },
    });
    const tick = await runDueSchedules({ workspaceId, limit: 5 });
    expect(tick.dueCount).toBe(1);
    expect(tick.results[0]?.status).toBe("CREATED");
    const scheduledTaskId = tick.results[0]?.taskId;
    expect(scheduledTaskId).toBeTruthy();

    // 轮询后台任务完成（Mock 很快，但不要依赖固定延时）
    const deadline = Date.now() + 15_000;
    let taskStatus = "";
    while (Date.now() < deadline) {
      const task = await prisma.searchTask.findUnique({ where: { id: scheduledTaskId! }, select: { status: true } });
      taskStatus = task?.status ?? "";
      if (taskStatus === "COMPLETED" || taskStatus === "FAILED" || taskStatus === "PARTIAL_FAILED") break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(taskStatus).toBe("COMPLETED");

    const run = await prisma.scheduleRun.findFirst({ where: { scheduleId: created.schedule.id }, orderBy: { createdAt: "desc" } });
    expect(run).toBeTruthy();
    const runDeadline = Date.now() + 15_000;
    let runStatus = run?.status ?? "";
    while (Date.now() < runDeadline) {
      const fresh = await prisma.scheduleRun.findUnique({ where: { id: run!.id }, select: { status: true } });
      runStatus = fresh?.status ?? "";
      if (runStatus === "COMPLETED" || runStatus === "FAILED") break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(runStatus).toBe("COMPLETED");
    const scheduleDeadline = Date.now() + 10_000;
    let scheduleAfter = await prisma.schedule.findUnique({ where: { id: created.schedule.id } });
    while (Date.now() < scheduleDeadline && scheduleAfter?.lastRunStatus !== "COMPLETED" && scheduleAfter?.lastRunStatus !== "FAILED") {
      await new Promise((resolve) => setTimeout(resolve, 200));
      scheduleAfter = await prisma.schedule.findUnique({ where: { id: created.schedule.id } });
    }
    expect(scheduleAfter?.lastRunStatus).toBe("COMPLETED");
    expect(scheduleAfter?.nextRunAt?.getTime()).toBeGreaterThan(Date.now());

    // 幂等：同一计划时间不会重复创建任务
    const duplicate = await runDueSchedules({ workspaceId, limit: 5, now: new Date() });
    expect(duplicate.dueCount).toBe(0);
  }, 45_000);

  it("问题集编辑生成新版本，历史任务的问题快照不被覆盖", async () => {
    const { prisma } = await import("@/server/db/client");
    const { publishQuestionSetVersion } = await import("@/server/services/question-set-service");
    const before = await prisma.questionSetVersion.findMany({
      where: { questionSetId },
      orderBy: { version: "desc" },
      take: 1,
    });
    expect(before[0]?.version).toBe(1);
    const question = await prisma.question.findFirst({ where: { questionSetId } });
    await prisma.question.update({ where: { id: question!.id }, data: { text: "修改后的问题文本" } });
    const version = await publishQuestionSetVersion(workspaceId, questionSetId, userId, {
      changedQuestionIds: [question!.id],
      note: "集成测试修改",
    });
    expect(version.version).toBe(2);
    const historical = await prisma.questionSetVersion.findFirst({
      where: { questionSetId, version: 1 },
    });
    const snapshotTexts = (historical?.questions as Array<{ text: string }>).map((q) => q.text);
    expect(snapshotTexts.some((t) => t === "修改后的问题文本")).toBe(false);
    const oldItem = await prisma.searchTaskItem.findFirst({ where: { taskId: baselineTaskId, questionId: question!.id } });
    expect(oldItem?.questionText).not.toBe("修改后的问题文本");
  });
});
