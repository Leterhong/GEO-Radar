/**
 * 证据链 / 矩阵 / 复测 / 比较 / 报告 / 定时采集 的端到端冒烟。
 * 需要服务端设置 ALLOW_MOCK_REPORTS=true（仅测试环境），因为本脚本使用 MOCK 任务验证报告流程。
 *
 * 运行：node scripts/smoke-evidence-chain.mjs
 */
import fs from "node:fs";
import path from "node:path";

function loadEnvLocal() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    let value = (match[2] ?? "").trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}
loadEnvLocal();

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3100";
let cookieJar = new Map();

function cookieHeader() {
  return Array.from(cookieJar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

let failures = 0;
function check(name, cond, detail = "") {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures += 1;
  console.log(`[${mark}] ${name}${detail ? " — " + detail : ""}`);
}

async function api(path, options = {}) {
  const header = cookieHeader();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(header ? { cookie: header } : {}),
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
  return { status: res.status, json, text };
}

async function pollTask(taskId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let task = null;
  while (Date.now() < deadline) {
    const res = await api(`/api/search-tasks/${taskId}`);
    task = res.json?.data?.task ?? null;
    if (task && !["QUEUED", "RUNNING"].includes(task.status)) return task;
    await new Promise((r) => setTimeout(r, 300));
  }
  return task;
}

async function main() {
  const email = `evidence-smoke-${Date.now()}@georadar.test`;
  const password = "SmokeTest123";

  const reg = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "证据链冒烟", agreeTerms: true }),
  });
  check("注册并自动创建工作空间", reg.status === 200 && Boolean(reg.json?.data?.workspaceId), JSON.stringify(reg.json?.error ?? {}));

  const brand = await api("/api/brands", {
    method: "POST",
    body: JSON.stringify({
      name: "SmokeAcme 品牌",
      aliases: ["SmokeAcme"],
      websiteUrl: "https://smoke-acme.example.com",
      officialSubdomains: ["docs.smoke-acme.example.com"],
      products: ["Smoke Search"],
    }),
  });
  const brandId = brand.json?.data?.id;
  check("创建品牌（含官方子域与产品名）", brand.status === 200 && brand.json?.data?.officialSubdomains?.length === 1 && brand.json?.data?.products?.length === 1);

  await api("/api/competitors", {
    method: "POST",
    body: JSON.stringify({ brandId, name: "SmokeRival", aliases: ["RivalSmoke"], websiteUrl: "https://rival.example.com" }),
  });

  const set = await api("/api/question-sets", { method: "POST", body: JSON.stringify({ name: "证据链冒烟问题集" }) });
  const questionSetId = set.json?.data?.id;
  check("创建问题集（初始化版本 1）", set.status === 200 && Boolean(questionSetId));

  const questionTexts = [
    { text: "SmokeAcme 品牌是什么", category: "品牌认知" },
    { text: "Smoke Search 有哪些功能", category: "产品功能" },
    { text: "SmokeAcme 和 SmokeRival 哪个好", category: "产品对比" },
    { text: "SmokeAcme 值得购买吗", category: "购买决策" },
  ];
  for (const q of questionTexts) {
    const created = await api("/api/questions", {
      method: "POST",
      body: JSON.stringify({ questionSetId, ...q, priority: 4 }),
    });
    if (created.status !== 200) console.log("question create failed", created.json);
  }
  const versions = await api(`/api/question-sets/${questionSetId}/versions`);
  check("每次问题变更生成新版本", versions.status === 200 && versions.json?.data?.versions?.length >= 5, `versions=${versions.json?.data?.versions?.length}`);

  const copied = await api(`/api/question-sets/${questionSetId}/copy`, {
    method: "POST",
    body: JSON.stringify({ name: "证据链冒烟问题集（副本）" }),
  });
  check("复制问题集（新 ID、版本 1）", copied.status === 200 && copied.json?.data?.questionSetId !== questionSetId && copied.json?.data?.version === 1);

  const task = await api("/api/search-tasks", {
    method: "POST",
    body: JSON.stringify({
      name: "证据链冒烟-基线",
      brandId,
      questionSetId,
      executionMode: "MOCK",
      maxResults: 5,
    }),
  });
  const baselineTaskId = task.json?.data?.id;
  check("创建基线任务（QUEUED）并冻结问题集版本", task.status === 200 && task.json?.data?.status === "QUEUED" && task.json?.data?.questionSetVersion >= 2, `version=${task.json?.data?.questionSetVersion}`);

  const duplicate = await api("/api/search-tasks", {
    method: "POST",
    body: JSON.stringify({
      name: "证据链冒烟-基线",
      brandId,
      questionSetId,
      executionMode: "MOCK",
      maxResults: 5,
    }),
  });
  check("60 秒内重复提交相同任务被拒绝", duplicate.status === 400 && duplicate.json?.error?.code === "DUPLICATE_TASK", JSON.stringify(duplicate.json?.error ?? {}));

  const start = await api(`/api/search-tasks/${baselineTaskId}/start`, { method: "POST" });
  check("用户确认后执行", start.status === 200 && start.json?.data?.accepted === true);
  const finished = await pollTask(baselineTaskId);
  check("基线任务完成且无空结果", finished?.status === "COMPLETED" && finished?.successItems === 4 && finished?.emptyItems === 0, JSON.stringify(finished ?? {}));

  const matrix = await api(`/api/matrix?brandId=${brandId}&includeMock=true`);
  const dataset = matrix.json?.data?.dataset;
  check("品牌问题矩阵返回数据集", matrix.status === 200 && dataset?.questions?.length === 4, JSON.stringify(matrix.json?.error ?? {}));
  check("矩阵按服务端口径计算有效问题", dataset?.metrics?.find((m) => m.key === "brand_mention_question_rate")?.denominator === 4);
  check(
    "矩阵单元格可下钻证据",
    dataset?.questions?.[0]?.cells?.some((c) => c.evidenceIds.length > 0 && c.state === "FOUND")
  );
  check("页面类型分布已生成", (dataset?.pageTypeDistribution?.length ?? 0) > 0);
  check("矩阵包含竞品实体", dataset?.entities?.some((e) => e.kind === "COMPETITOR"));

  const evidenceId = dataset?.evidence?.[0]?.id;
  const evidenceDetail = await api(`/api/evidence/${evidenceId}`);
  check(
    "证据详情包含原始 URL、规范化 URL、页面类型与规则版本",
    evidenceDetail.status === 200 &&
      evidenceDetail.json?.data?.evidence?.url &&
      evidenceDetail.json?.data?.evidence?.normalizedUrl &&
      evidenceDetail.json?.data?.evidence?.ruleVersion,
    JSON.stringify(evidenceDetail.json?.error ?? {})
  );

  const reviewed = await api(`/api/evidence/${evidenceId}`, {
    method: "PATCH",
    body: JSON.stringify({ reviewAction: "CONFIRM_MATCH", reviewNote: "冒烟确认匹配" }),
  });
  check("人工确认匹配并保留原始数据", reviewed.status === 200 && reviewed.json?.data?.detectionMethod === "MANUAL" && reviewed.json?.data?.mentionStatus === "CONFIRMED_BRAND");
  const pageTypeReview = await api(`/api/evidence/${evidenceId}`, {
    method: "PATCH",
    body: JSON.stringify({ pageType: "THIRD_PARTY_MEDIA", reviewNote: "冒烟修正页面类型" }),
  });
  check("人工修正页面类型", pageTypeReview.status === 200 && pageTypeReview.json?.data?.pageType === "THIRD_PARTY_MEDIA" && pageTypeReview.json?.data?.pageTypeSource === "MANUAL");
  const afterReview = await api(`/api/evidence/${evidenceId}`);
  check("复核历史留痕（操作人与前后值）", (afterReview.json?.data?.evidence?.reviews?.length ?? 0) >= 2 && afterReview.json?.data?.evidence?.reviews[0]?.next);

  const recompute = await api(`/api/search-tasks/${baselineTaskId}/snapshots`, {
    method: "POST",
    body: JSON.stringify({ kind: "RECOMPUTE" }),
  });
  check("用当前规则重算并生成 RECOMPUTE 快照", recompute.status === 200 && recompute.json?.data?.mode === "RECOMPUTE" && recompute.json?.data?.snapshotId);
  const snapshotList = await api(`/api/search-tasks/${baselineTaskId}/snapshots`);
  check(
    "采集快照与重算快照并列保存",
    snapshotList.status === 200 && snapshotList.json?.data?.snapshots?.some((s) => s.kind === "COLLECTION") && snapshotList.json?.data?.snapshots?.some((s) => s.kind === "RECOMPUTE"),
    JSON.stringify(snapshotList.json?.data?.snapshots?.map((s) => s.kind))
  );

  const retest = await api(`/api/search-tasks/${baselineTaskId}/retest`, {
    method: "POST",
    body: JSON.stringify({ name: "证据链冒烟-复测" }),
  });
  const retestTaskId = retest.json?.data?.task?.id;
  check("创建复测任务并关联基线", retest.status === 200 && retestTaskId && retest.json?.data?.task?.baselineTaskId === baselineTaskId);
  const retestBefore = await api(`/api/search-tasks/${retestTaskId}/results`);
  check("复测任务创建时不复用上一轮结果", (retestBefore.json?.data?.results?.length ?? 0) === 0);
  await api(`/api/search-tasks/${retestTaskId}/start`, { method: "POST" });
  const retestFinished = await pollTask(retestTaskId);
  check("复测执行完成", retestFinished?.status === "COMPLETED" && retestFinished?.successItems === 4);

  const comparison = await api(`/api/comparisons?baseline=${baselineTaskId}&retest=${retestTaskId}`);
  const comp = comparison.json?.data?.comparison;
  check("两轮比较可用且共同问题正确", comparison.status === 200 && comp?.comparable === true && comp?.questions?.totalCommon === 4, JSON.stringify(comparison.json?.error ?? {}));
  check("比较默认使用采集时 COLLECTION 快照", comp?.baseline?.dataSource === "SNAPSHOT" && comp?.retest?.dataSource === "SNAPSHOT", JSON.stringify({ b: comp?.baseline?.dataSource, r: comp?.retest?.dataSource }));
  check("比较包含共同子集指标与波动说明", (comp?.commonSubset?.metrics?.length ?? 0) === 3 && comp?.volatility?.intervalLabel?.includes("不是置信区间"));
  check("比较包含页面增减与不可比较问题列表", Array.isArray(comp?.pageDiff?.persistedPages) && Array.isArray(comp?.questions?.uncomparable));

  const event = await api("/api/optimization-events", {
    method: "POST",
    body: JSON.stringify({
      brandId,
      name: "冒烟：产品页补充 FAQ",
      occurredAt: new Date().toISOString(),
      contentChanged: "产品页新增 5 个常见问题",
      pageUrls: ["https://smoke-acme.example.com/product"],
      note: "仅记录时间关联，不代表因果",
      baselineTaskId,
      retestTaskId,
    }),
  });
  check("记录优化事件", event.status === 200 && Boolean(event.json?.data?.id));

  const report = await api("/api/reports", {
    method: "POST",
    body: JSON.stringify({ taskId: retestTaskId, compareTaskId: baselineTaskId, title: "证据链冒烟对比报告" }),
  });
  check("生成两轮对比报告", report.status === 200 && report.json?.data?.kind === "COMPARISON", JSON.stringify(report.json?.error ?? {}));
  const reportId = report.json?.data?.id;
  const reportDetail = await api(`/api/reports/${reportId}`);
  const reportSnapshot = reportDetail.json?.data?.report?.snapshot;
  check(
    "报告保存搜索报告快照（含指标、矩阵、口径）",
    reportDetail.status === 200 &&
      reportSnapshot?.schemaVersion === "search-report-v1" &&
      reportSnapshot?.metrics?.length > 0 &&
      reportSnapshot?.matrix?.questions?.length === 4 &&
      reportSnapshot?.methodology?.length > 0,
    reportSnapshot?.schemaVersion ?? "no-snapshot"
  );
  for (const [format, needle] of [
    ["md", "## 7. 品牌问题矩阵"],
    ["html", "<!doctype html>"],
    ["csv", "brand_mention_question_rate"],
    ["questions-csv", "question,"],
    ["evidence-csv", "evidence_id"],
  ]) {
    const res = await fetch(`${BASE}/api/reports/${reportId}/export?format=${format}`, { headers: { cookie: cookieHeader() } });
    const text = await res.text();
    check(`报告导出 ${format}`, res.status === 200 && text.includes(needle), `status=${res.status} length=${text.length}`);
  }

  const schedule = await api("/api/schedules", {
    method: "POST",
    body: JSON.stringify({
      name: "证据链冒烟排期",
      brandId,
      questionSetId,
      frequency: "DAILY",
      timezone: "Asia/Shanghai",
      hour: 9,
      minute: 0,
      executionMode: "MOCK",
      confirmedCost: true,
      params: { maxResults: 5 },
    }),
  });
  const scheduleId = schedule.json?.data?.schedule?.id;
  check("创建定时排期并计算下次执行时间", schedule.status === 200 && scheduleId && schedule.json?.data?.nextRunAt, JSON.stringify(schedule.json?.error ?? {}));
  const scheduleList = await api("/api/schedules");
  check("排期列表包含执行配置与限额", scheduleList.status === 200 && scheduleList.json?.data?.schedules?.some((s) => s.id === scheduleId));
  const runNow = await api(`/api/schedules/${scheduleId}/run`, { method: "POST" });
  check("立即执行排期创建真实任务", runNow.status === 200 && runNow.json?.data?.taskId, JSON.stringify(runNow.json?.error ?? {}));
  const scheduledTask = await pollTask(runNow.json?.data?.taskId);
  check("定时任务执行完成", scheduledTask?.status === "COMPLETED");
  const pause = await api(`/api/schedules/${scheduleId}`, { method: "PATCH", body: JSON.stringify({ status: "PAUSED" }) });
  check("暂停排期并清空下次执行时间", pause.status === 200 && pause.json?.data?.status === "PAUSED" && pause.json?.data?.nextRunAt === null);
  const resume = await api(`/api/schedules/${scheduleId}`, { method: "PATCH", body: JSON.stringify({ status: "ACTIVE" }) });
  check("恢复排期并重新计算下次执行时间", resume.status === 200 && resume.json?.data?.status === "ACTIVE" && resume.json?.data?.nextRunAt);
  const tickHeaders = process.env.CRON_SECRET ? { "x-cron-secret": process.env.CRON_SECRET } : {};
  const tick = await api("/api/schedules/tick", { method: "POST", body: "{}", headers: tickHeaders });
  check(
    process.env.CRON_SECRET
      ? "携带 CRON_SECRET 可触发 tick（全局调度入口）"
      : "登录用户可触发 tick（未配置 CRON_SECRET 时仅当前空间）",
    tick.status === 200 && typeof tick.json?.data?.dueCount === "number",
    JSON.stringify(tick.json?.error ?? {})
  );
  if (process.env.CRON_SECRET) {
    const denied = await api("/api/schedules/tick", { method: "POST", body: "{}" });
    check("缺少 x-cron-secret 的 tick 被拒绝（401）", denied.status === 401, `status=${denied.status}`);
  }
  const cancelled = await api(`/api/schedules/${scheduleId}`, { method: "DELETE" });
  check("取消排期保留历史", cancelled.status === 200 && cancelled.json?.data?.status === "CANCELLED");

  console.log(failures === 0 ? "\nALL EVIDENCE-CHAIN SMOKE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("evidence-chain smoke crashed:", error);
  process.exitCode = 1;
});
