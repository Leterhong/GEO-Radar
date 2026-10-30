import { prisma } from "@/server/db/client";
import { sameSite } from "./domain-normalization";

// —— 规则型 GEO 优化建议（不依赖大模型）——
// 每条建议都能追溯到具体问题与证据；证据不足时给出“需要进一步验证”表述，
// 不做确定性诊断，不承诺任何提升。

export interface GeneratedRecommendation {
  type: string;
  title: string;
  description: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  evidenceIds: string[];
  questionRefs: string[];
}

export interface RecommendationGenerateResult {
  brandId: string;
  generated: number;
  skippedExisting: number;
  details: Array<{ type: string; title: string; questionCount: number }>;
}

const RULE_NOTE =
  "该建议由规则引擎基于已保存的搜索证据生成，反映的是本次可比样本中的现象，不构成确定性诊断；请在优化后通过复测观察变化。";

export async function generateRecommendations(
  workspaceId: string,
  brandId: string
): Promise<RecommendationGenerateResult> {
  const brand = await prisma.brand.findFirst({ where: { id: brandId, workspaceId } });
  if (!brand) {
    return { brandId, generated: 0, skippedExisting: 0, details: [] };
  }

  const items = await prisma.searchTaskItem.findMany({
    where: {
      workspaceId,
      status: "SUCCESS",
      task: { executionMode: "REAL", source: "LAB", brandId },
    },
    orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }],
    select: {
      questionId: true,
      questionText: true,
      results: {
        select: {
          id: true,
          domain: true,
          url: true,
          evidence: { select: { id: true, mentionStatus: true, competitorMatches: true } },
        },
      },
    },
  });

  // 每个问题取最新一次成功执行
  const latestByQuestion = new Map<string, (typeof items)[number]>();
  for (const item of items) {
    if (item.questionId === null) continue;
    latestByQuestion.set(item.questionId, item);
  }

  const candidates: GeneratedRecommendation[] = [];
  const missingBrandQuestions: Array<{ questionId: string; evidenceIds: string[] }> = [];
  const competitorOnlyQuestions: Array<{ questionId: string; evidenceIds: string[]; competitor: string }> = [];
  const lowEvidenceQuestions: string[] = [];

  for (const [questionId, item] of latestByQuestion) {
    const evidenceIds = item.results.flatMap((r) => r.evidence.map((e) => e.id));
    const brandMentioned = item.results.some((r) =>
      r.evidence.some((e) => e.mentionStatus === "CONFIRMED_BRAND")
    );
    if (!brandMentioned) {
      missingBrandQuestions.push({ questionId, evidenceIds });
      if (evidenceIds.length === 0) lowEvidenceQuestions.push(questionId);
    }
    // 竞品出现而品牌未出现的具体竞品
    if (!brandMentioned) {
      const counter = new Map<string, string[]>();
      for (const r of item.results) {
        for (const e of r.evidence) {
          for (const name of e.competitorMatches) {
            counter.set(name, [...(counter.get(name) ?? []), e.id]);
          }
        }
      }
      for (const [competitor, eIds] of counter) {
        competitorOnlyQuestions.push({ questionId, evidenceIds: eIds, competitor });
      }
    }
  }

  if (missingBrandQuestions.length > 0) {
    const evidenceIds = dedupe(missingBrandQuestions.flatMap((q) => q.evidenceIds)).slice(0, 20);
    const questionRefs = missingBrandQuestions.map((q) => q.questionId);
    candidates.push({
      type: "BRAND_MISSING",
      title: `品牌在 ${missingBrandQuestions.length} 个问题的搜索结果中未被检测到`,
      description: `在有效完成的搜索样本中，以下问题未检测到品牌名称或官网域名的提及。可能的原因包括品牌公开信息不足、介绍与问题意图不匹配、相关页面缺少明确事实信息。建议补充品牌介绍与产品/服务页面中的事实内容，并在优化后复测。${RULE_NOTE}`,
      priority: missingBrandQuestions.length >= 5 ? "HIGH" : "MEDIUM",
      evidenceIds,
      questionRefs,
    });
  }

  // 按竞品聚合“竞品出现而本品牌未出现”
  const byCompetitor = new Map<string, { questionIds: string[]; evidenceIds: string[] }>();
  for (const entry of competitorOnlyQuestions) {
    const existing = byCompetitor.get(entry.competitor) ?? { questionIds: [], evidenceIds: [] };
    existing.questionIds.push(entry.questionId);
    existing.evidenceIds.push(...entry.evidenceIds);
    byCompetitor.set(entry.competitor, existing);
  }
  for (const [competitor, data] of byCompetitor) {
    if (data.questionIds.length === 0) continue;
    candidates.push({
      type: "COMPETITOR_ADVANTAGE",
      title: `竞品「${competitor}」在 ${data.questionIds.length} 个问题中出现而本品牌未出现`,
      description: `在相同问题的搜索结果中检测到竞品「${competitor}」的提及，而未检测到本品牌。可以对比竞品的公开信息结构（产品页、使用场景、FAQ），补充本品牌在这些问题上的事实内容。${RULE_NOTE}`,
      priority: data.questionIds.length >= 3 ? "MEDIUM" : "LOW",
      evidenceIds: dedupe(data.evidenceIds).slice(0, 20),
      questionRefs: dedupe(data.questionIds),
    });
  }

  if (brand.websiteDomain) {
    const officialCovered = new Set<string>();
    for (const [questionId, item] of latestByQuestion) {
      const hit = item.results.some((r) => sameSite(r.domain ?? hostFromUrl(r.url), brand.websiteDomain));
      if (hit) officialCovered.add(questionId);
    }
    const total = latestByQuestion.size;
    if (total > 0 && officialCovered.size / total < 0.3) {
      candidates.push({
        type: "OFFICIAL_SITE_LOW",
        title: "官网来源覆盖率较低",
        description: `在 ${total} 个有效问题中，仅 ${officialCovered.size} 个问题的搜索结果包含品牌官网来源。建议检查官网是否包含与目标问题匹配的事实型内容（产品说明、使用场景、常见问题），并确认官网可被正常访问和收录。${RULE_NOTE}`,
        priority: "MEDIUM",
        evidenceIds: [],
        questionRefs: Array.from(latestByQuestion.keys()).slice(0, 20),
      });
    }
  } else {
    candidates.push({
      type: "OFFICIAL_SITE_MISSING",
      title: "品牌尚未配置官网域名",
      description: "未配置官网域名，无法计算官网来源覆盖率。请在品牌设置中填写官网地址后复测。",
      priority: "LOW",
      evidenceIds: [],
      questionRefs: [],
    });
  }

  // 去重：同品牌同类型已存在 OPEN/IN_PROGRESS 的建议则跳过
  const existing = await prisma.optimizationTask.findMany({
    where: { workspaceId, brandId, status: { in: ["OPEN", "IN_PROGRESS", "NEEDS_VERIFICATION"] } },
    select: { type: true },
  });
  const existingTypes = new Set(existing.map((e) => e.type));

  let generated = 0;
  let skippedExisting = 0;
  const details: RecommendationGenerateResult["details"] = [];
  for (const candidate of candidates) {
    if (existingTypes.has(candidate.type)) {
      skippedExisting += 1;
      continue;
    }
    await prisma.optimizationTask.create({
      data: {
        workspaceId,
        brandId,
        title: candidate.title,
        description: candidate.description,
        type: candidate.type,
        priority: candidate.priority,
        status: "OPEN",
        evidenceIds: candidate.evidenceIds,
        questionRefs: candidate.questionRefs,
      },
    });
    generated += 1;
    details.push({ type: candidate.type, title: candidate.title, questionCount: candidate.questionRefs.length });
  }

  return { brandId, generated, skippedExisting, details };
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
