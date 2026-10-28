import { prisma } from "@/server/db/client";
import { writeAuditLog } from "@/server/api/helpers";
import type { AnalysisTask, AnalysisMetric, Report } from "@prisma/client";

export class ReportError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export interface ReportSnapshot {
  reportTitle: string;
  brand: { name: string; websiteDomain: string | null; aliases: string[] } | null;
  scope: {
    days: number;
    keywordFilter: string | null;
    dataSource: string;
    samplesIncluded: number;
    validAnswers: number;
    answersWithoutSources: number;
    labValidQuestions: number;
    competitors: string[];
  };
  dataWindow: { from: string; to: string };
  metrics: Array<{
    key: string;
    label: string;
    value: number | null;
    numerator: number;
    denominator: number;
    insufficient: boolean;
    formulaVersion: string;
    notes: string | null;
    breakdown: unknown;
  }>;
  limitations: string[];
  generatedAt: string;
}

function formatLocal(date: Date): string {
  return new Date(date).toLocaleString("zh-CN", { hour12: false });
}

function pct(value: number | null): string {
  if (value === null) return "不可计算";
  return `${(value * 100).toFixed(1)}%`;
}

/** 由分析任务生成报告快照（指标值全部来自已落库的 AnalysisMetric）。 */
export async function createReport(
  workspaceId: string,
  userId: string,
  analysisTaskId: string,
  title?: string
) {
  const task = await prisma.analysisTask.findFirst({
    where: { id: analysisTaskId, workspaceId },
    include: { brand: true, metrics: true },
  });
  if (!task) throw new ReportError("ANALYSIS_NOT_FOUND", "分析任务不存在或不属于当前工作空间");
  if (task.status === "RUNNING" || task.status === "QUEUED") {
    throw new ReportError("ANALYSIS_RUNNING", "分析任务尚未完成，无法生成报告");
  }
  if (task.metrics.length === 0) {
    throw new ReportError("NO_METRICS", "该分析任务没有可用的指标结果");
  }

  const competitors = await prisma.competitor.findMany({
    where: { id: { in: task.competitorIds } },
    select: { name: true },
  });
  const scope = (task.scope ?? {}) as { dataSource?: string };
  const finishedAt = task.finishedAt ?? new Date();
  const windowFrom = new Date(finishedAt.getTime() - task.days * 24 * 60 * 60 * 1000);

  const labMetricRow = task.metrics.find((m) => m.key === "lab_question_set_breakdown");
  const labMetric = labMetricRow
    ? { breakdown: labMetricRow.breakdown as Array<{ validQuestions: number }> | null }
    : null;

  const limitations: string[] = [];
  if (task.answerCount === 0)
    limitations.push("answer 级指标（品牌提及率/引用率/竞品提及率）依赖「搜索问答」模式生成的回答；统计范围内为 0 条，故标记为不可计算。");
  if (task.sampleSize > task.answerCount) {
    limitations.push(`有 ${task.sampleSize - task.answerCount} 条执行未返回可核查来源，未计入分母。`);
  }
  if (!task.brand?.websiteDomain) limitations.push("品牌未配置官网域名，官网引用率无法计算。");
  if (task.metrics.some((m) => m.insufficient)) limitations.push("部分指标因样本不足标记为不可计算。");
  limitations.push("指标仅反映已保存的搜索问答样本，不能证明品牌在 AI 搜索生态中的整体曝光。");

  const snapshot: ReportSnapshot = {
    reportTitle: title?.trim() || `${task.brand?.name ?? "品牌"} GEO 分析报告`,
    brand: task.brand
      ? { name: task.brand.name, websiteDomain: task.brand.websiteDomain, aliases: task.brand.aliases }
      : null,
    scope: {
      days: task.days,
      keywordFilter: task.keywordFilter,
      dataSource: scope.dataSource ?? "已保存的搜索问答回答",
      samplesIncluded: task.sampleSize,
      validAnswers: task.answerCount,
      answersWithoutSources: task.sampleSize - task.answerCount,
      labValidQuestions: labMetric
        ? (labMetric.breakdown as Array<{ validQuestions: number }> | null)?.reduce((sum, row) => sum + row.validQuestions, 0) ?? 0
        : 0,
      competitors: competitors.map((c) => c.name),
    },
    dataWindow: { from: windowFrom.toISOString(), to: finishedAt.toISOString() },
    metrics: task.metrics
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((m) => ({
        key: m.key,
        label: m.label,
        value: m.value,
        numerator: m.numerator,
        denominator: m.denominator,
        insufficient: m.insufficient,
        formulaVersion: m.formulaVersion,
        notes: m.notes,
        breakdown: m.breakdown,
      })),
    limitations,
    generatedAt: new Date().toISOString(),
  };

  const markdown = renderMarkdown(snapshot);
  const report = await prisma.report.create({
    data: {
      workspaceId,
      analysisTaskId: task.id,
      brandId: task.brandId,
      title: snapshot.reportTitle.slice(0, 150),
      snapshot: snapshot as never,
      markdown,
      dataWindowFrom: windowFrom,
      dataWindowTo: finishedAt,
      createdById: userId,
    },
  });
  await writeAuditLog({
    workspaceId,
    userId,
    action: "REPORT_CREATED",
    targetType: "Report",
    targetId: report.id,
    metadata: { analysisTaskId: task.id },
  });
  return report;
}

export function renderMarkdown(snapshot: ReportSnapshot): string {
  const lines: string[] = [];
  lines.push(`# ${snapshot.reportTitle}`);
  lines.push("");
  lines.push(
    `- 目标品牌：${snapshot.brand?.name ?? "未指定"}${snapshot.brand?.websiteDomain ? `（官网：${snapshot.brand.websiteDomain}）` : ""}`
  );
  lines.push(`- 统计窗口：${snapshot.dataWindow.from.slice(0, 10)} ~ ${snapshot.dataWindow.to.slice(0, 10)}（近 ${snapshot.scope.days} 天）`);
  lines.push(`- 数据来源：${snapshot.scope.dataSource}`);
  lines.push(
    `- 样本：answer 级执行 ${snapshot.scope.samplesIncluded} 条（有效回答 ${snapshot.scope.validAnswers} 条）；实验室问题集样本 ${snapshot.scope.labValidQuestions} 个有效问题`
  );
  if (snapshot.scope.keywordFilter) lines.push(`- 关键词过滤：${snapshot.scope.keywordFilter}`);
  if (snapshot.scope.competitors.length > 0) lines.push(`- 对比竞品：${snapshot.scope.competitors.join("、")}`);
  lines.push(`- 报告生成时间：${formatLocal(new Date(snapshot.generatedAt))}`);
  lines.push("");
  lines.push("## 核心指标");
  lines.push("");
  lines.push("| 指标 | 数值 | 分子 / 分母 | 公式版本 | 说明 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const metric of snapshot.metrics) {
    if (metric.key === "keyword_breakdown" || metric.key === "daily_trend" || metric.key === "lab_question_set_breakdown") continue;
    const value =
      metric.key === "valid_answers" || metric.key === "brand_mention_count"
        ? String(metric.numerator)
        : metric.insufficient
          ? "不可计算"
          : pct(metric.value);
    lines.push(
      `| ${metric.label} | ${value} | ${metric.numerator} / ${metric.denominator} | ${metric.formulaVersion} | ${(metric.notes ?? "").replace(/\|/g, "／")} |`
    );
  }
  lines.push("");

  const keyword = snapshot.metrics.find((m) => m.key === "keyword_breakdown");
  if (keyword && Array.isArray(keyword.breakdown) && (keyword.breakdown as unknown[]).length > 0) {
    lines.push("## 关键词表现");
    lines.push("");
    lines.push("| 关键词 | 有效回答 | 品牌提及 | 提及率 |");
    lines.push("| --- | --- | --- | --- |");
    for (const row of keyword.breakdown as Array<{ keyword: string; answers: number; brandMentioned: number; rate: number | null }>) {
      lines.push(`| ${row.keyword} | ${row.answers} | ${row.brandMentioned} | ${pct(row.rate)} |`);
    }
    lines.push("");
  }

  const lab = snapshot.metrics.find((m) => m.key === "lab_question_set_breakdown");
  if (lab && Array.isArray(lab.breakdown) && (lab.breakdown as unknown[]).length > 0) {
    lines.push("## 问题集表现（实验室任务）");
    lines.push("");
    lines.push("| 问题集 | 有效问题 | 品牌出现 | 出现率 |");
    lines.push("| --- | --- | --- | --- |");
    for (const row of lab.breakdown as Array<{ questionSet: string; validQuestions: number; brandAppeared: number; rate: number | null }>) {
      lines.push(`| ${row.questionSet} | ${row.validQuestions} | ${row.brandAppeared} | ${pct(row.rate)} |`);
    }
    lines.push("");
  }

  const trend = snapshot.metrics.find((m) => m.key === "daily_trend");
  if (trend && Array.isArray(trend.breakdown) && (trend.breakdown as unknown[]).length > 0) {
    lines.push("## 品牌提及趋势");
    lines.push("");
    lines.push("| 日期 | 有效回答 | 品牌提及 | 提及率 |");
    lines.push("| --- | --- | --- | --- |");
    for (const row of trend.breakdown as Array<{ date: string; answers: number; brandMentioned: number; rate: number | null }>) {
      lines.push(`| ${row.date} | ${row.answers} | ${row.brandMentioned} | ${pct(row.rate)} |`);
    }
    lines.push("");
  }

  lines.push("## 数据限制");
  lines.push("");
  for (const item of snapshot.limitations) lines.push(`- ${item}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("本报告由 GEO Radar 基于已保存的搜索证据自动生成；指标由确定性代码计算，未使用模型生成数值。");
  return lines.join("\n");
}

/** 结构化指标 CSV（含口径与分母，便于复核） */
export function renderMetricsCsv(snapshot: ReportSnapshot): string {
  const rows: string[][] = [["metric_key", "label", "value", "numerator", "denominator", "formula_version", "insufficient", "notes"]];
  for (const metric of snapshot.metrics) {
    rows.push([
      metric.key,
      metric.label,
      metric.value === null ? "" : String(metric.value),
      String(metric.numerator),
      String(metric.denominator),
      metric.formulaVersion,
      metric.insufficient ? "true" : "false",
      metric.notes ?? "",
    ]);
  }
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return rows.map((row) => row.map(escape).join(",")).join("\n") + "\n";
}

export function getReportSnapshot(report: Report): ReportSnapshot {
  return report.snapshot as unknown as ReportSnapshot;
}

export async function getReportOrThrow(workspaceId: string, reportId: string) {
  const report = await prisma.report.findFirst({
    where: { id: reportId, workspaceId },
    include: { brand: { select: { name: true } } },
  });
  if (!report) throw new ReportError("NOT_FOUND", "报告不存在或不属于当前工作空间");
  return report;
}

export type { AnalysisTask, AnalysisMetric };
