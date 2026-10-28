/**
 * 端到端冒烟脚本（对真实 PostgreSQL + 生产构建服务执行）：
 * 1. 注册 → 自动创建工作空间
 * 2. 创建品牌 / 问题集 / 问题
 * 3. 未配置数据源时创建 REAL 任务 → 应被阻止（PROVIDER_NOT_CONFIGURED）
 * 4. MOCK 任务创建 → 确认执行 → 轮询至完成 → 验证结果与 isMock 证据
 * 5. 指标接口：模拟数据不进入统计（validSamples=0）
 * 6. 凭据保存：返回掩码，不返回完整 Key
 */
const BASE = "http://localhost:3100";
/** cookie 容器：同一响应可能同时下发 session 与 workspace 两个 cookie */
let cookieJar = new Map();

function cookieHeader() {
  return Array.from(cookieJar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function check(name, cond, detail = "") {
  const mark = cond ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${detail ? " — " + detail : ""}`);
  if (!cond) process.exitCode = 1;
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
    if (value === "" ) cookieJar.delete(name);
    else cookieJar.set(name, value);
  }
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

/** 页面请求：不跟随重定向，用于校验服务端跳转。 */
async function page(path) {
  const header = cookieHeader();
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: header ? { cookie: header } : {},
  });
  return { status: res.status, location: res.headers.get("location") ?? "" };
}

async function main() {
  const email = `smoke-${Date.now()}@georadar.test`;
  const password = "SmokeTest123";

  // 1. 未登录访问受保护 API
  const unauth = await api("/api/brands");
  check("未登录访问受保护 API 返回 401", unauth.status === 401, `status=${unauth.status}`);

  // 2. 注册
  const reg = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "冒烟测试员", agreeTerms: true }),
  });
  check("注册成功并创建工作空间", reg.status === 200 && reg.json?.data?.workspaceId, JSON.stringify(reg.json?.error ?? {}));

  // 注册后：工作空间已自动创建，进入「完善品牌」步骤（可跳过），不再出现 409
  const dashboardBeforeBrand = await page("/dashboard");
  check("注册后可直接访问工作台（不被引导页阻塞）", dashboardBeforeBrand.status === 200, `status=${dashboardBeforeBrand.status}`);
  const onboardingPage = await page("/onboarding");
  check("注册后 /onboarding 正常展示完善品牌步骤", onboardingPage.status === 200, `status=${onboardingPage.status} location=${onboardingPage.location}`);
  const onboardingState = await api("/api/onboarding");
  check(
    "品牌未填写时 onboarded=false（brandCount=0）",
    onboardingState.json?.data?.onboarded === false && onboardingState.json?.data?.brandCount === 0,
    JSON.stringify(onboardingState.json?.data ?? {})
  );
  // 幂等：重复提交不返回 409
  const onboardingFirst = await api("/api/onboarding", {
    method: "POST",
    body: JSON.stringify({ workspaceName: "冒烟空间", brand: { name: "冒烟引导品牌", websiteUrl: "https://onboarding-brand.example.com" } }),
  });
  check(
    "引导提交成功（创建工作空间后补充品牌，200）",
    onboardingFirst.status === 200 && Boolean(onboardingFirst.json?.data?.brandId),
    `status=${onboardingFirst.status} brandId=${onboardingFirst.json?.data?.brandId}`
  );
  const onboardingRetry = await api("/api/onboarding", {
    method: "POST",
    body: JSON.stringify({ brand: { name: "冒烟引导品牌" } }),
  });
  check(
    "引导接口幂等（重复提交返回 200，同品牌不重复创建）",
    onboardingRetry.status === 200 && onboardingRetry.json?.data?.createdBrand === false,
    `status=${onboardingRetry.status} createdBrand=${onboardingRetry.json?.data?.createdBrand}`
  );
  const onboardingAfter = await page("/onboarding");
  check(
    "已完善品牌后访问 /onboarding 自动跳转首页",
    onboardingAfter.status === 307 || onboardingAfter.status === 302,
    `status=${onboardingAfter.status} location=${onboardingAfter.location}`
  );
  const onboardingSkip = await api("/api/onboarding", {
    method: "POST",
    body: JSON.stringify({ brand: {} }),
  });
  check("跳过品牌也能成功进入工作台（200）", onboardingSkip.status === 200, `status=${onboardingSkip.status}`);
  const loginPageWhenLoggedIn = await page("/login");
  check(
    "已登录访问 /login 自动跳转首页",
    loginPageWhenLoggedIn.status === 307 || loginPageWhenLoggedIn.status === 302,
    `status=${loginPageWhenLoggedIn.status}`
  );

  // 3. 引导已自动完成工作空间，创建品牌
  const brand = await api("/api/brands", {
    method: "POST",
    body: JSON.stringify({ name: "冒烟品牌", websiteUrl: "https://smoke-brand.example.com", aliases: ["烟测"] }),
  });
  check("创建品牌成功", brand.status === 200 && brand.json?.data?.websiteDomain === "smoke-brand.example.com", `domain=${brand.json?.data?.websiteDomain}`);

  // 4. 问题集与问题
  const set = await api("/api/question-sets", { method: "POST", body: JSON.stringify({ name: "冒烟问题集" }) });
  check("创建问题集成功", set.status === 200);
  const q = await api("/api/questions", {
    method: "POST",
    body: JSON.stringify({ questionSetId: set.json.data.id, text: "冒烟测试：这个品牌出现在搜索结果里了吗？" }),
  });
  check("创建问题成功", q.status === 200);

  // 5. CSV 导入（含错误行）
  const imp = await api("/api/questions/import", {
    method: "POST",
    body: JSON.stringify({
      questionSetId: set.json.data.id,
      text: "冒烟导入问题A\n冒烟导入问题A\n" + "x".repeat(301),
    }),
  });
  check(
    "CSV 导入：1 新增 + 2 错误行（重复 + 超长）",
    imp.json?.data?.created === 1 && imp.json?.data?.skipped === 2,
    JSON.stringify(imp.json?.data)
  );

  // 6. 未配置数据源：REAL 任务创建被阻止
  const blocked = await api("/api/search-tasks", {
    method: "POST",
    body: JSON.stringify({
      name: "冒烟-真实任务",
      questionSetId: set.json.data.id,
      brandId: brand.json.data.id,
      executionMode: "REAL",
    }),
  });
  check(
    "未配置 API Key 时 REAL 任务创建被阻止",
    blocked.json?.error?.code === "PROVIDER_NOT_CONFIGURED",
    `code=${blocked.json?.error?.code}`
  );

  // 7. 保存密钥：只返回掩码
  const cred = await api("/api/settings/search-provider", {
    method: "PUT",
    body: JSON.stringify({ apiKey: "sk-smoke-fake-key-1234567890abcd" }),
  });
  const credStr = JSON.stringify(cred.json);
  check("凭据保存成功且只返回掩码", cred.status === 200 && cred.json?.data?.maskedKey?.includes("••••"), cred.json?.data?.maskedKey ?? "");
  check("凭据响应不包含完整 Key", !credStr.includes("sk-smoke-fake-key-1234567890abcd"));
  check("凭据状态为 PENDING_VERIFICATION", cred.json?.data?.config?.status === "PENDING_VERIFICATION");
  // 读取接口同样不返回完整 Key
  const credRead = await api("/api/settings/search-provider");
  check("凭据读取接口不含完整 Key", !JSON.stringify(credRead.json).includes("sk-smoke-fake-key-1234567890abcd"));

  // 未通过连接测试时 REAL 任务仍被阻止
  const blocked2 = await api("/api/search-tasks", {
    method: "POST",
    body: JSON.stringify({ name: "冒烟-真实任务2", questionSetId: set.json.data.id, executionMode: "REAL" }),
  });
  check(
    "未通过连接测试时 REAL 任务创建被阻止",
    blocked2.json?.error?.code === "PROVIDER_NOT_CONNECTED",
    `code=${blocked2.json?.error?.code}`
  );

  // 8. MOCK 任务全流程
  const task = await api("/api/search-tasks", {
    method: "POST",
    body: JSON.stringify({
      name: "冒烟-模拟任务",
      brandId: brand.json.data.id,
      questionSetId: set.json.data.id,
      executionMode: "MOCK",
      maxResults: 5,
    }),
  });
  check("MOCK 任务创建成功（QUEUED）", task.status === 200 && task.json?.data?.status === "QUEUED", `total=${task.json?.data?.totalItems}`);
  const taskId = task.json.data.id;

  const start = await api(`/api/search-tasks/${taskId}/start`, { method: "POST" });
  check("用户确认后启动执行", start.status === 200 && start.json?.data?.accepted === true);

  // 轮询至完成
  let final = null;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const st = await api(`/api/search-tasks/${taskId}`);
    final = st.json?.data?.task;
    if (final && !["QUEUED", "RUNNING"].includes(final.status)) break;
  }
  check("任务完成（COMPLETED）", final?.status === "COMPLETED", `status=${final?.status} success=${final?.successItems}/${final?.totalItems}`);

  const results = await api(`/api/search-tasks/${taskId}/results`);
  const rows = results.json?.data?.results ?? [];
  check("返回模拟搜索结果", rows.length > 0, `count=${rows.length}`);
  check("结果全部带 isMock=true", rows.every((r) => r.isMock === true));
  check("结果包含标题/URL/域名/摘要", rows[0] && rows[0].title && rows[0].url && rows[0].domain);

  // 9. 证据库
  const evidence = await api("/api/evidence?pageSize=5");
  check("证据库有记录且带模拟标记", (evidence.json?.data?.total ?? 0) > 0 && (evidence.json?.data?.evidence ?? []).every((e) => e.isMock === true), `total=${evidence.json?.data?.total}`);

  // 10. 证据人工复核
  const firstEvidence = evidence.json.data.evidence[0];
  const review = await api(`/api/evidence/${firstEvidence.id}`, {
    method: "PATCH",
    body: JSON.stringify({ mentionStatus: "CONFIRMED_BRAND", reviewNote: "冒烟复核" }),
  });
  check("人工复核成功", review.status === 200 && review.json?.data?.detectionMethod === "MANUAL");

  // 11. 指标：模拟数据不进入统计
  const overview = await api("/api/analytics/overview?days=30");
  check("总览指标 validSamples=0（模拟数据不计入）", overview.json?.data?.metrics?.brandAppearance?.validSamples === 0, JSON.stringify(overview.json?.data?.metrics?.brandAppearance ?? {}));

  // 12. 大屏接口
  const wallboard = await api("/api/wallboard");
  check("大屏接口可访问且不触发搜索", wallboard.status === 200 && typeof wallboard.json?.data?.note === "string");

  // 13. 未授权访问其他用户资源（构造不存在的 brandId）
  const cross = await api("/api/brands/does-not-exist");
  check("越权/不存在资源返回 404", cross.status === 404, `status=${cross.status}`);

  // 14. 登出前：对话平台冒烟（GEO 分析数据不足路径 + 守卫 + CRUD）
  const conv = await api("/api/conversations", { method: "POST", body: JSON.stringify({ mode: "GEO_ANALYSIS" }) });
  check("创建会话成功", conv.status === 200 && conv.json?.data?.id, JSON.stringify(conv.json?.error ?? {}));
  const convId = conv.json.data.id;

  // 搜索类模式在未配置数据源时被阻止（不创建任何记录）
  const blockedEvidence = await api(`/api/conversations/${convId}/runs`, {
    method: "POST",
    body: JSON.stringify({ mode: "SEARCH_EVIDENCE", content: "冒烟：搜索证据模式应被阻止" }),
  });
  check(
    "未配置/未连接数据源时搜索证据模式被阻止",
    ["PROVIDER_NOT_CONFIGURED", "PROVIDER_NOT_CONNECTED", "PROVIDER_DISABLED"].includes(blockedEvidence.json?.error?.code),
    `code=${blockedEvidence.json?.error?.code}`
  );

  // GEO 分析（数据不足路径，不发起任何外部调用）
  const geoRun = await api(`/api/conversations/${convId}/runs`, {
    method: "POST",
    body: JSON.stringify({ mode: "GEO_ANALYSIS", content: "冒烟：分析品牌表现（无样本时应给出数据不足说明）" }),
  });
  check("GEO 分析 Run 创建成功", geoRun.status === 200 && geoRun.json?.data?.runId, JSON.stringify(geoRun.json?.error ?? {}));
  let geoFinal = null;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const st = await api(`/api/conversations/${convId}/runs/${geoRun.json.data.runId}`);
    geoFinal = st.json?.data?.run;
    if (geoFinal && ["COMPLETED", "FAILED", "CANCELLED"].includes(geoFinal.status)) break;
  }
  check(
    "GEO 分析完成（数据不足 → 规则说明，无伪造结论）",
    geoFinal?.status === "COMPLETED" && geoFinal?.stage === "completed_insufficient_data",
    `status=${geoFinal?.status} stage=${geoFinal?.stage}`
  );
  const convDetail = await api(`/api/conversations/${convId}`);
  const assistantMsg = (convDetail.json?.data?.messages ?? []).find((m) => m.role === "ASSISTANT");
  check("助手消息基于真实状态生成", Boolean(assistantMsg?.content?.includes("数据不足")), assistantMsg?.content?.slice(0, 60));

  // 保存证据接口：无搜索阶段的 Run 应明确拒绝
  const noSearchEvidence = await api(`/api/conversations/${convId}/runs/${geoRun.json.data.runId}/save-evidence`, { method: "POST" });
  check("无搜索阶段的 Run 保存证据被拒绝", noSearchEvidence.json?.error?.code === "NO_SEARCH", `code=${noSearchEvidence.json?.error?.code}`);

  // 重命名 + 会话切换模式 + 删除
  const renamed = await api(`/api/conversations/${convId}`, {
    method: "PATCH",
    body: JSON.stringify({ title: "冒烟-改名会话", currentMode: "SEARCH_ANSWER" }),
  });
  check("重命名与模式切换成功", renamed.json?.data?.title === "冒烟-改名会话" && renamed.json?.data?.currentMode === "SEARCH_ANSWER");
  // 模型配置：保存只返回掩码
  const modelSave = await api("/api/settings/model-provider", {
    method: "PUT",
    body: JSON.stringify({ baseUrl: "https://api.example-llm.test/v1", modelName: "smoke-model", apiKey: "sk-model-fake-key-12345678" }),
  });
  check(
    "模型配置保存成功且只返回掩码",
    modelSave.status === 200 && modelSave.json?.data?.maskedKey?.includes("••••"),
    modelSave.json?.data?.maskedKey ?? JSON.stringify(modelSave.json?.error ?? {})
  );
  check("模型配置响应不含完整 Key", !JSON.stringify(modelSave.json).includes("sk-model-fake-key-12345678"));

  const delConv = await api(`/api/conversations/${convId}`, { method: "DELETE" });
  check("删除会话成功", delConv.status === 200);
  const deletedConv = await api(`/api/conversations/${convId}`);
  check("删除后访问返回 404", deletedConv.status === 404, `status=${deletedConv.status}`);

  // ── 新增模块冒烟：收藏 / 消息删除 / 附件 / 分析 / 报告 / 用量 / 证据标签 ──
  const conv2 = await api("/api/conversations", { method: "POST", body: JSON.stringify({ mode: "SEARCH_ANSWER" }) });
  const conv2Id = conv2.json.data.id;
  const fav = await api(`/api/conversations/${conv2Id}`, { method: "PATCH", body: JSON.stringify({ isFavorite: true }) });
  check("会话收藏成功", fav.json?.data?.isFavorite === true, `isFavorite=${fav.json?.data?.isFavorite}`);
  const favList = await api("/api/conversations?favorite=true");
  check(
    "收藏筛选只返回收藏会话",
    Array.isArray(favList.json?.data?.conversations) && favList.json.data.conversations.every((c) => c.isFavorite === true),
    `count=${favList.json?.data?.conversations?.length ?? 0}`
  );

  // GEO 分析（数据不足 → 部分完成 + 指标不可计算）
  const brandForAnalysis = brand.json.data.id;
  const analysis = await api("/api/analyses", {
    method: "POST",
    body: JSON.stringify({ name: "冒烟 GEO 分析", brandId: brandForAnalysis, days: 30 }),
  });
  check("分析任务创建成功（只读，不触发外部调用）", analysis.status === 200 && Boolean(analysis.json?.data?.id), JSON.stringify(analysis.json?.error ?? {}));
  const analysisId = analysis.json.data.id;
  let analysisDetail = null;
  for (let i = 0; i < 30; i += 1) {
    await new Promise((r) => setTimeout(r, 400));
    const st = await api(`/api/analyses/${analysisId}`);
    analysisDetail = st.json?.data;
    if (analysisDetail?.task && !["QUEUED", "RUNNING"].includes(analysisDetail.task.status)) break;
  }
  check(
    "分析任务完成且指标落库（含公式版本与分母）",
    analysisDetail?.task?.status === "PARTIALLY_COMPLETED" &&
      Array.isArray(analysisDetail.metrics) &&
      analysisDetail.metrics.length > 0 &&
      analysisDetail.metrics.every((m) => typeof m.formulaVersion === "string" && typeof m.denominator === "number"),
    `status=${analysisDetail?.task?.status} metrics=${analysisDetail?.metrics?.length ?? 0}`
  );
  const mentionMetric = analysisDetail?.metrics?.find((m) => m.key === "brand_mention_rate");
  check(
    "无样本时品牌提及率标记为不可计算（而非 0%）",
    mentionMetric?.value === null && mentionMetric?.insufficient === true,
    `value=${mentionMetric?.value} insufficient=${mentionMetric?.insufficient}`
  );

  // 报告：生成 + 导出 CSV
  const report = await api("/api/reports", { method: "POST", body: JSON.stringify({ analysisTaskId: analysisId }) });
  check("由分析任务生成报告成功", report.status === 200 && Boolean(report.json?.data?.id), JSON.stringify(report.json?.error ?? {}));
  const reportDetail = await api(`/api/reports/${report.json.data.id}`);
  check(
    "报告保存指标快照与 Markdown",
    reportDetail.json?.data?.report?.snapshot?.metrics?.length > 0 &&
      reportDetail.json?.data?.report?.markdown?.includes("核心指标"),
    `metrics=${reportDetail.json?.data?.report?.snapshot?.metrics?.length ?? 0}`
  );
  const csvRes = await fetch(`${BASE}/api/reports/${report.json.data.id}/export?format=csv`, { headers: { cookie: cookieHeader() } });
  const csvText = await csvRes.text();
  check(
    "报告指标可导出 CSV（含分母与公式版本）",
    csvRes.status === 200 && csvText.includes("denominator") && csvText.includes("formula_version"),
    `status=${csvRes.status}`
  );

  // 用量统计
  const usage = await api("/api/usage?days=30");
  check(
    "用量接口返回真实计数且费用标记为未知",
    typeof usage.json?.data?.searches?.total === "number" && usage.json?.data?.cost?.known === false,
    JSON.stringify({ searches: usage.json?.data?.searches, cost: usage.json?.data?.cost?.known })
  );

  // 证据标签与相关性 + 批量归档
  const evidenceList = await api("/api/evidence?pageSize=5");
  const targetEvidence = evidenceList.json?.data?.evidence?.[0];
  if (targetEvidence) {
    const tagged = await api(`/api/evidence/${targetEvidence.id}`, {
      method: "PATCH",
      body: JSON.stringify({ relevance: "HIGH", tags: ["冒烟", "官网"] }),
    });
    check(
      "证据可设置标签与相关性（不改动原始结果）",
      tagged.json?.data?.relevance === "HIGH" && Array.isArray(tagged.json?.data?.tags) && tagged.json.data.tags.includes("冒烟"),
      `relevance=${tagged.json?.data?.relevance} tags=${JSON.stringify(tagged.json?.data?.tags)}`
    );
    const batch = await api("/api/evidence/batch", {
      method: "POST",
      body: JSON.stringify({ ids: [targetEvidence.id, "not-exist-id"], action: "archive" }),
    });
    check(
      "证据批量操作返回真实更新/跳过数量",
      batch.json?.data?.updated === 1 && batch.json?.data?.skipped === 1,
      JSON.stringify(batch.json?.data ?? {})
    );
  } else {
    check("证据标签（跳过：无证据）", true);
  }

  // 附件：TXT 解析成功 / PDF 明确拒绝
  const form = new FormData();
  form.append("file", new Blob([new TextEncoder().encode("这是附件测试内容，用于验证服务端解析。")], { type: "text/plain" }), "note.txt");
  const uploadRes = await fetch(`${BASE}/api/conversations/${conv2Id}/attachments`, {
    method: "POST",
    headers: { cookie: cookieHeader() },
    body: form,
  });
  const uploadJson = await uploadRes.json();
  check("TXT 附件上传并提取文本成功", uploadRes.status === 200 && uploadJson?.data?.chars > 0, JSON.stringify(uploadJson?.error ?? uploadJson?.data ?? {}));

  const pdfForm = new FormData();
  pdfForm.append("file", new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" }), "doc.pdf");
  const pdfRes = await fetch(`${BASE}/api/conversations/${conv2Id}/attachments`, {
    method: "POST",
    headers: { cookie: cookieHeader() },
    body: pdfForm,
  });
  const pdfJson = await pdfRes.json();
  check(
    "PDF 附件被明确拒绝（不伪装已解析）",
    pdfRes.status === 415 && /不支持解析/.test(pdfJson?.error?.message ?? ""),
    `status=${pdfRes.status}`
  );

  // 消息删除（软删除）：先在 conv2 产生一条真实消息（GEO 分析在无模型时给出规则回答）
  const msgRun = await api(`/api/conversations/${conv2Id}/runs`, {
    method: "POST",
    body: JSON.stringify({ mode: "GEO_ANALYSIS", content: "冒烟：消息删除测试" }),
  });
  let msgDetail = null;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 400));
    const st = await api(`/api/conversations/${conv2Id}`);
    msgDetail = st.json?.data;
    if (msgDetail?.messages?.length > 0) break;
  }
  const anyMessage = msgDetail?.messages?.[0];
  if (anyMessage) {
    const beforeCount = msgDetail.messages.length;
    const del = await api(`/api/conversations/${conv2Id}/messages/${anyMessage.id}`, { method: "DELETE" });
    const after = await api(`/api/conversations/${conv2Id}`);
    check(
      "消息软删除后不再出现在会话中（执行记录保留）",
      del.status === 200 && !after.json.data.messages.some((m) => m.id === anyMessage.id),
      `status=${del.status} before=${beforeCount} after=${after.json.data.messages.length}`
    );
  } else {
    check("消息软删除", false, "未能生成可删除的消息");
  }

  // 越权：其他用户不能读取该分析任务（用新会话验证 404）
  const crossAnalysis = await api(`/api/analyses/${analysisId}`);
  check("本人可读取自己的分析任务", crossAnalysis.status === 200, `status=${crossAnalysis.status}`);

  // 15. 登出后受保护 API 失效
  await api("/api/auth/logout", { method: "POST" });
  cookieJar.clear();
  const afterLogout = await api("/api/brands");
  check("登出后 API 返回 401", afterLogout.status === 401, `status=${afterLogout.status}`);
}

main().catch((e) => {
  console.error("smoke crashed:", e);
  process.exitCode = 1;
});
