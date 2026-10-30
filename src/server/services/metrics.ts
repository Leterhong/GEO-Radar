import { prisma } from "@/server/db/client";
import { isConfiguredOfficialHost } from "./domain-normalization";

// —— 统一指标口径（所有页面共用，前端不得另行计算）——
// 品牌出现率 = 至少一条有效结果被规则确认为本品牌的已完成问题数 ÷ 有效已完成问题总数
// 问题覆盖率 = 存在至少一条有效结果的问题数 ÷ 有效已完成问题总数
// 官网来源覆盖率 = 至少一条结果来自品牌官网域名（同站判定）的问题数 ÷ 有效已完成问题总数
// 失败/取消/未执行的问题不计入分母，单独统计。
// 仅使用真实数据（isMock=false），模拟任务不进入统计。

export interface MetricSample {
  value: number | null; // 0~1；null 表示无有效样本
  validSamples: number;
  numerator: number;
  methodology: string;
}

export interface OverviewMetrics {
  brandAppearance: MetricSample;
  questionCoverage: MetricSample;
  officialSiteCoverage: MetricSample;
  thirdPartyCoverage: MetricSample;
  completedTasks: number;
  runningTasks: number;
  failedItemTotal: number;
  pendingRecommendations: number;
  brandCount: number;
  competitorCount: number;
  questionCount: number;
  evidenceCount: number;
  failedTaskCount: number;
  pendingReviewCount: number;
  reportCount: number;
  lastCollectedAt: string | null;
  since: string;
}

function methodologyFor(name: string): string {
  return `${name}：有效已完成问题（真实模式、状态成功）作为分母；失败、取消与未执行的问题不计入分母；同一问题只计一次。`;
}

/**
 * 以“最近一次成功执行的每问题结果”为统计单元。
 * 只统计真实任务（executionMode=REAL 且 isMock=false）。
 */
export async function computeOverviewMetrics(
  workspaceId: string,
  brandId: string | undefined,
  sinceDays: number
): Promise<OverviewMetrics> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const items = await prisma.searchTaskItem.findMany({
    where: {
      workspaceId,
      status: "SUCCESS",
      task: {
        executionMode: "REAL",
        source: "LAB",
        brandId: brandId ?? undefined,
        OR: [{ startedAt: { gte: since } }, { startedAt: null }],
      },
    },
    orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }],
    select: {
      questionId: true,
      results: {
        select: {
          id: true,
          domain: true,
          url: true,
          evidence: { select: { mentionStatus: true, thirdPartyMention: true } },
        },
      },
    },
  });

  // 每个问题只取最新一条成功执行（按 executedAt 排序由查询顺序保证 → 取 map 后的第一个）
  const byQuestion = new Map<string, typeof items>();
  for (const item of items) {
    if (item.questionId === null) continue;
    const list = byQuestion.get(item.questionId) ?? [];
    list.push(item);
    byQuestion.set(item.questionId, list);
  }

  let validSamples = 0;
  let brandAppeared = 0;
  let covered = 0;
  let officialSiteCovered = 0;
  let thirdPartyCovered = 0;
  let brandWebsiteDomain: string | null = null;
  let brandOfficialSubdomains: string[] = [];
  if (brandId) {
    const brand = await prisma.brand.findFirst({ where: { id: brandId, workspaceId } });
    brandWebsiteDomain = brand?.websiteDomain ?? null;
    brandOfficialSubdomains = brand?.officialSubdomains ?? [];
  }

  for (const [, list] of byQuestion) {
    const latest = list[list.length - 1];
    if (!latest) continue;
    validSamples += 1;
    const results = latest.results;
    if (results.length > 0) covered += 1;
    const brandMentioned = results.some((r) => r.evidence.some((e) => e.mentionStatus === "CONFIRMED_BRAND"));
    if (brandMentioned) brandAppeared += 1;
    const thirdPartyMentioned = results.some((r) =>
      r.evidence.some((e) => e.thirdPartyMention && e.mentionStatus !== "IRRELEVANT")
    );
    if (thirdPartyMentioned) thirdPartyCovered += 1;
    if (brandWebsiteDomain || brandOfficialSubdomains.length > 0) {
      const officialHit = results.some((r) =>
        isConfiguredOfficialHost(r.domain ?? hostFromUrl(r.url), brandWebsiteDomain, brandOfficialSubdomains)
      );
      if (officialHit) officialSiteCovered += 1;
    }
  }

  const rate = (numerator: number): MetricSample["value"] => (validSamples > 0 ? numerator / validSamples : null);
  const brandName = "品牌出现率";

  const [completedTasks, runningTasks, failedItemTotal, pendingRecommendations, brandCount, competitorCount, questionCount, evidenceCount, failedTaskCount, pendingReviewCount, reportCount, lastTask] = await Promise.all([
    prisma.searchTask.count({ where: { workspaceId, executionMode: "REAL", source: "LAB", status: { in: ["COMPLETED", "PARTIAL_FAILED"] }, brandId: brandId ?? undefined } }),
    prisma.searchTask.count({ where: { workspaceId, status: "RUNNING", brandId: brandId ?? undefined } }),
    prisma.searchTaskItem.count({ where: { workspaceId, status: "FAILED", task: { executionMode: "REAL", source: "LAB", brandId: brandId ?? undefined } } }),
    prisma.optimizationTask.count({ where: { workspaceId, status: { in: ["OPEN", "IN_PROGRESS", "NEEDS_VERIFICATION"] }, brandId: brandId ?? undefined } }),
    prisma.brand.count({ where: { workspaceId } }),
    prisma.competitor.count({ where: { workspaceId, brandId: brandId ?? undefined } }),
    prisma.question.count({ where: { workspaceId, enabled: true } }),
    prisma.evidence.count({ where: { workspaceId, isMock: false, brandId: brandId ?? undefined } }),
    prisma.searchTask.count({ where: { workspaceId, status: "FAILED", brandId: brandId ?? undefined } }),
    prisma.evidence.count({ where: { workspaceId, isMock: false, mentionStatus: "PENDING_REVIEW", brandId: brandId ?? undefined } }),
    prisma.report.count({ where: { workspaceId, brandId: brandId ?? undefined } }),
    prisma.searchTask.findFirst({ where: { workspaceId, brandId: brandId ?? undefined }, orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }], select: { finishedAt: true, startedAt: true, createdAt: true } }),
  ]);
  const lastCollectedAt = lastTask?.finishedAt ?? lastTask?.startedAt ?? lastTask?.createdAt ?? null;


  return {
    brandAppearance: {
      value: rate(brandAppeared),
      validSamples,
      numerator: brandAppeared,
      methodology: methodologyFor(brandName),
    },
    questionCoverage: {
      value: rate(covered),
      validSamples,
      numerator: covered,
      methodology: methodologyFor("问题覆盖率"),
    },
    officialSiteCoverage: {
      value: brandWebsiteDomain || brandOfficialSubdomains.length > 0 ? rate(officialSiteCovered) : null,
      validSamples,
      numerator: officialSiteCovered,
      methodology: brandWebsiteDomain || brandOfficialSubdomains.length > 0
        ? methodologyFor("官网来源覆盖率")
        : "官网来源覆盖率：品牌尚未配置官网域名，无法计算。请在品牌设置中填写官网地址。",
    },
    thirdPartyCoverage: {
      value: rate(thirdPartyCovered),
      validSamples,
      numerator: thirdPartyCovered,
      methodology: methodologyFor("第三方页面覆盖率"),
    },
    completedTasks,
    runningTasks,
    failedItemTotal,
    pendingRecommendations,
    brandCount,
    competitorCount,
    questionCount,
    evidenceCount,
    failedTaskCount,
    pendingReviewCount,
    reportCount,
    lastCollectedAt: lastCollectedAt?.toISOString() ?? null,
    since: since.toISOString(),
  };
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export interface BrandTrendPoint {
  date: string;
  appearanceRate: number | null;
  officialRate: number | null;
  thirdPartyRate: number | null;
  validSamples: number;
}

/** 品牌出现趋势：只使用数据库真实历史记录；无数据的日期不生成虚假连续曲线。 */
export async function computeBrandTrend(
  workspaceId: string,
  brandId: string,
  sinceDays: number
): Promise<BrandTrendPoint[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const brand = await prisma.brand.findFirst({ where: { id: brandId, workspaceId }, select: { websiteDomain: true, officialSubdomains: true } });
  const hasOfficialConfig = Boolean(brand?.websiteDomain || (brand?.officialSubdomains?.length ?? 0) > 0);
  const evidence = await prisma.evidence.findMany({
    where: {
      workspaceId,
      brandId,
      isMock: false,
      collectedAt: { gte: since },
      task: { executionMode: "REAL", source: "LAB" },
    },
    select: {
      collectedAt: true,
      questionId: true,
      mentionStatus: true,
      officialDomainMatch: true,
      thirdPartyMention: true,
    },
  });
  const byDayQuestion = new Map<string, { appeared: boolean; official: boolean; thirdParty: boolean }>();
  for (const row of evidence) {
    if (!row.questionId) continue;
    const day = row.collectedAt.toISOString().slice(0, 10);
    const key = `${day}:${row.questionId}`;
    const state = byDayQuestion.get(key) ?? { appeared: false, official: false, thirdParty: false };
    if (row.mentionStatus === "CONFIRMED_BRAND") state.appeared = true;
    if (row.officialDomainMatch) state.official = true;
    if (row.thirdPartyMention && row.mentionStatus !== "IRRELEVANT") state.thirdParty = true;
    byDayQuestion.set(key, state);
  }
  const byDay = new Map<string, { appeared: number; official: number; thirdParty: number; total: number }>();
  for (const [key, state] of byDayQuestion) {
    const day = key.split(":")[0] ?? "";
    if (!day) continue;
    const entry = byDay.get(day) ?? { appeared: 0, official: 0, thirdParty: 0, total: 0 };
    entry.total += 1;
    if (state.appeared) entry.appeared += 1;
    if (state.official) entry.official += 1;
    if (state.thirdParty) entry.thirdParty += 1;
    byDay.set(day, entry);
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entry]) => ({
      date,
      appearanceRate: entry.total > 0 ? entry.appeared / entry.total : null,
      officialRate: hasOfficialConfig && entry.total > 0 ? entry.official / entry.total : null,
      thirdPartyRate: entry.total > 0 ? entry.thirdParty / entry.total : null,
      validSamples: entry.total,
    }));
}

export interface SourceDomainRow {
  domain: string;
  evidenceCount: number;
  questionCount: number;
}

/** 来源域名排行（真实数据）。 */
export async function computeSourceDomains(
  workspaceId: string,
  brandId: string | undefined,
  sinceDays: number,
  limit = 10
): Promise<SourceDomainRow[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.evidence.groupBy({
    by: ["domain"],
    where: {
      workspaceId,
      brandId: brandId ?? undefined,
      isMock: false,
      collectedAt: { gte: since },
      domain: { not: null },
      task: { executionMode: "REAL", source: "LAB" },
    },
    _count: { domain: true, questionId: true },
    orderBy: { _count: { domain: "desc" } },
    take: limit,
  });
  return rows
    .filter((r) => r.domain)
    .map((r) => ({
      domain: r.domain as string,
      evidenceCount: r._count.domain,
      questionCount: r._count.questionId,
    }));
}

export interface CompetitorMetricRow {
  competitorId: string;
  name: string;
  appearanceRate: number | null;
  validSamples: number;
  sharedSourceDomains: string[];
}

/** 竞品指标：与品牌同一口径（有效已完成问题分母）。 */
export async function computeCompetitorMetrics(
  workspaceId: string,
  brandId: string,
  sinceDays: number
): Promise<CompetitorMetricRow[]> {
  const competitors = await prisma.competitor.findMany({ where: { workspaceId, brandId, enabled: true } });
  if (competitors.length === 0) return [];
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const items = await prisma.searchTaskItem.findMany({
    where: {
      workspaceId,
      status: "SUCCESS",
      task: { executionMode: "REAL", source: "LAB", brandId, OR: [{ startedAt: { gte: since } }, { startedAt: null }] },
    },
    orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }],
    select: {
      questionId: true,
      results: { select: { evidence: { select: { competitorMatches: true } } } },
    },
  });
  const byQuestion = new Map<string, { competitorHits: Set<string>[] }>();
  for (const item of items) {
    if (item.questionId === null) continue;
    const list = byQuestion.get(item.questionId) ?? { competitorHits: [] };
    list.competitorHits.push(new Set(item.results.flatMap((r) => r.evidence.flatMap((e) => e.competitorMatches))));
    byQuestion.set(item.questionId, list);
  }
  return competitors.map((competitor) => {
    let appeared = 0;
    let validSamples = 0;
    for (const [, entry] of byQuestion) {
      const latest = entry.competitorHits[entry.competitorHits.length - 1];
      if (!latest) continue;
      validSamples += 1;
      if (latest.has(competitor.name)) appeared += 1;
    }
    return {
      competitorId: competitor.id,
      name: competitor.name,
      appearanceRate: validSamples > 0 ? appeared / validSamples : null,
      validSamples,
      sharedSourceDomains: [],
    };
  });
}
