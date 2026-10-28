import { prisma } from "@/server/db/client";
import { isConfiguredOfficialHost } from "./domain-normalization";

export interface ExperimentComparison {
  baseline: { taskId: string; name: string; finishedAt: string | null; totalItems: number; successItems: number; failedItems: number };
  retest: { taskId: string; name: string; finishedAt: string | null; totalItems: number; successItems: number; failedItems: number };
  comparable: boolean;
  sampleWarning: string | null;
  metrics: {
    commonQuestions: number;
    baselineBrandAppearance: { value: number | null; validSamples: number };
    retestBrandAppearance: { value: number | null; validSamples: number };
    baselineOfficialSiteCoverage: { value: number | null; validSamples: number };
    retestOfficialSiteCoverage: { value: number | null; validSamples: number };
    baselineQuestionCoverage: { value: number | null; validSamples: number };
    retestQuestionCoverage: { value: number | null; validSamples: number };
  };
  newEvidenceUrls: string[];
  disappearedEvidenceUrls: string[];
  disclaimer: string;
}

const DISCLAIMER =
  "变化仅反映本次可比搜索样本中的结果差异，不能单独证明变化完全由某项优化导致。搜索结果本身存在波动。";

/** 对比两个搜索任务：要求同品牌、同数据源、同执行模式；样本不一致时给出限制提示。 */
export async function compareTasks(
  workspaceId: string,
  baselineTaskId: string,
  retestTaskId: string
): Promise<ExperimentComparison> {
  const [baseline, retest] = await Promise.all([
    prisma.searchTask.findFirst({ where: { id: baselineTaskId, workspaceId } }),
    prisma.searchTask.findFirst({ where: { id: retestTaskId, workspaceId } }),
  ]);
  if (!baseline || !retest) throw new Error("任务不存在或不属于当前工作空间");
  if (baseline.brandId !== retest.brandId) throw new Error("两个任务关联的品牌不同，无法对比");
  if (baseline.provider !== retest.provider) throw new Error("两个任务使用的数据源不同，无法对比");
  if (baseline.executionMode !== retest.executionMode) throw new Error("两个任务的执行模式（真实/模拟）不同，无法对比");

  const [baselineItems, retestItems] = await Promise.all([
    prisma.searchTaskItem.findMany({
      where: { taskId: baselineTaskId, status: "SUCCESS" },
      select: {
        questionId: true,
        results: { select: { url: true, domain: true, evidence: { select: { mentionStatus: true } } } },
      },
    }),
    prisma.searchTaskItem.findMany({
      where: { taskId: retestTaskId, status: "SUCCESS" },
      select: {
        questionId: true,
        results: { select: { url: true, domain: true, evidence: { select: { mentionStatus: true } } } },
      },
    }),
  ]);

  const brand = baseline.brandId
    ? await prisma.brand.findFirst({ where: { id: baseline.brandId, workspaceId } })
    : null;

  const baselineByQ = new Map(
    baselineItems.filter((i): i is typeof i & { questionId: string } => i.questionId !== null).map((i) => [i.questionId, i])
  );
  const retestByQ = new Map(
    retestItems.filter((i): i is typeof i & { questionId: string } => i.questionId !== null).map((i) => [i.questionId, i])
  );
  const commonQuestions = Array.from(baselineByQ.keys()).filter((q) => retestByQ.has(q));
  const brandWebsiteDomain = brand?.websiteDomain ?? null;
  const brandOfficialSubdomains = brand?.officialSubdomains ?? [];

  function computeMetrics(items: typeof baselineItems, questionFilter: Set<string>) {
    let brandAppeared = 0;
    let covered = 0;
    let officialCovered = 0;
    const urls: string[] = [];
    for (const item of items) {
      if (item.questionId === null || !questionFilter.has(item.questionId)) continue;
      covered += 1;
      const mentioned = item.results.some((r) => r.evidence.some((e) => e.mentionStatus === "CONFIRMED_BRAND"));
      if (mentioned) brandAppeared += 1;
      if (brandWebsiteDomain || brandOfficialSubdomains.length > 0) {
        const officialHit = item.results.some((r) =>
          isConfiguredOfficialHost(r.domain ?? hostOf(r.url), brandWebsiteDomain, brandOfficialSubdomains)
        );
        if (officialHit) officialCovered += 1;
      }
      for (const r of item.results) urls.push(r.url);
    }
    const n = questionFilter.size;
    return {
      brandRate: n > 0 ? brandAppeared / n : null,
      coverage: n > 0 ? covered / n : null,
      officialRate: (brandWebsiteDomain || brandOfficialSubdomains.length > 0) && n > 0 ? officialCovered / n : null,
      validSamples: n,
      urls,
    };
  }

  const commonSet = new Set(commonQuestions);
  const base = computeMetrics(baselineItems, commonSet);
  const retestM = computeMetrics(retestItems, commonSet);

  const baseUrls = new Set(base.urls);
  const retestUrls = new Set(retestM.urls);
  const newEvidenceUrls = retestM.urls.filter((u) => !baseUrls.has(u)).slice(0, 50);
  const disappearedEvidenceUrls = base.urls.filter((u) => !retestUrls.has(u)).slice(0, 50);

  const sampleWarning =
    baselineByQ.size !== retestByQ.size
      ? `两次任务的成功样本数量不同（基线 ${baselineByQ.size} 个问题，复测 ${retestByQ.size} 个问题），对比仅基于共同成功的 ${commonQuestions.length} 个问题，结果存在样本限制。`
      : baseline.totalItems !== retest.totalItems
        ? `两次任务的原始问题总数不同，请确认问题集是否一致。`
        : null;

  return {
    baseline: {
      taskId: baseline.id,
      name: baseline.name,
      finishedAt: baseline.finishedAt?.toISOString() ?? null,
      totalItems: baseline.totalItems,
      successItems: baseline.successItems,
      failedItems: baseline.failedItems,
    },
    retest: {
      taskId: retest.id,
      name: retest.name,
      finishedAt: retest.finishedAt?.toISOString() ?? null,
      totalItems: retest.totalItems,
      successItems: retest.successItems,
      failedItems: retest.failedItems,
    },
    comparable: commonQuestions.length > 0,
    sampleWarning,
    metrics: {
      commonQuestions: commonQuestions.length,
      baselineBrandAppearance: { value: base.brandRate, validSamples: base.validSamples },
      retestBrandAppearance: { value: retestM.brandRate, validSamples: retestM.validSamples },
      baselineOfficialSiteCoverage: { value: base.officialRate, validSamples: base.validSamples },
      retestOfficialSiteCoverage: { value: retestM.officialRate, validSamples: retestM.validSamples },
      baselineQuestionCoverage: { value: base.coverage, validSamples: base.validSamples },
      retestQuestionCoverage: { value: retestM.coverage, validSamples: retestM.validSamples },
    },
    newEvidenceUrls,
    disappearedEvidenceUrls,
    disclaimer: DISCLAIMER,
  };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
