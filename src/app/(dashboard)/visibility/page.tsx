import { requireWorkspace } from "@/server/auth/guard";
import { prisma } from "@/server/db/client";
import { computeOverviewMetrics, computeBrandTrend, computeSourceDomains, computeCompetitorMetrics } from "@/server/services/metrics";
import { PageHeader, KpiCard, EmptyState } from "@/components/shared/kpi-card";
import { BrandFilter } from "@/components/shared/brand-filter";
import { OverviewTrendChart } from "@/components/dashboard/overview-trend-chart";
import { formatPercent } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { SetupGuide } from "@/components/shared/setup-guide";

export const dynamic = "force-dynamic";

export default async function VisibilityPage({
  searchParams,
}: {
  searchParams: { brandId?: string; days?: string };
}) {
  const { workspaceId } = await requireWorkspace();
  const brands = await prisma.brand.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  const brandId = searchParams.brandId ?? brands[0]?.id;
  const days = Math.min(365, Math.max(1, Number(searchParams.days ?? "30")));

  if (!brandId) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="品牌可见度" />
        <EmptyState
          title="尚未创建品牌"
          description="可见度分析围绕品牌进行。请先在设置或引导页创建品牌档案。"
          action={
            <Button asChild>
              <Link href="/settings?tab=workspace">去创建</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const brand = await prisma.brand.findFirst({ where: { id: brandId, workspaceId } });
  if (!brand) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="品牌可见度" />
        <EmptyState title="品牌不存在或不属于当前工作空间" />
      </div>
    );
  }

  const [credential, questionCount, taskCount] = await Promise.all([
    prisma.searchProviderCredential.findUnique({ where: { workspaceId } }),
    prisma.question.count({ where: { workspaceId } }),
    prisma.searchTask.count({ where: { workspaceId } }),
  ]);
  const [metrics, trend, sources, competitors] = await Promise.all([
    computeOverviewMetrics(workspaceId, brandId, days),
    computeBrandTrend(workspaceId, brandId, days),
    computeSourceDomains(workspaceId, brandId, days, 15),
    computeCompetitorMetrics(workspaceId, brandId, days),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="品牌可见度"
        description="以下指标基于「搜索结果证据中的品牌出现情况」，不等同于品牌被 AI 答案推荐的概率。"
        actions={<BrandFilter brands={brands} days={days} basePath="/visibility" currentBrandId={brandId} />}
      />

      {metrics.brandAppearance.validSamples === 0 ? (
        <div className="space-y-4">
          <SetupGuide
            state={{
              searchConfigured: credential?.status === "CONNECTED",
              questionCount,
              taskCount,
            }}
          />
          <EmptyState
            title="暂无有效搜索样本"
            description="对包含启用问题的问题集执行真实搜索后，这里会展示品牌出现率、官网来源覆盖率等指标。失败与取消的问题不会计入分母。"
            action={
              <Button asChild>
                <Link href="/search-lab">发起搜索</Link>
              </Button>
            }
            className="bg-card"
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard
              title="品牌出现率"
              value={formatPercent(metrics.brandAppearance.value)}
              sub={`分子 ${metrics.brandAppearance.numerator} · 有效样本 ${metrics.brandAppearance.validSamples}`}
              methodology={metrics.brandAppearance.methodology}
            />
            <KpiCard
              title="问题覆盖率"
              value={formatPercent(metrics.questionCoverage.value)}
              sub={`有效样本 ${metrics.questionCoverage.validSamples} · 失败问题 ${metrics.failedItemTotal}（不计入分母）`}
              methodology={metrics.questionCoverage.methodology}
            />
            <KpiCard
              title="官网来源覆盖率"
              value={metrics.officialSiteCoverage.value === null ? "暂无数据" : formatPercent(metrics.officialSiteCoverage.value)}
              sub={brand.websiteDomain ? `官网域名：${brand.websiteDomain}` : "请先在品牌档案中填写官网地址"}
              methodology={metrics.officialSiteCoverage.methodology}
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <OverviewTrendChart data={trend} />
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-[15px] font-semibold">来源域名分布</h3>
              {sources.length === 0 ? (
                <p className="mt-3 text-[13px] text-muted-foreground">暂无数据</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {sources.map((s) => {
                    const max = sources[0]?.evidenceCount ?? 1;
                    return (
                      <li key={s.domain} className="text-sm">
                        <div className="flex items-center justify-between">
                          <span className="truncate font-mono text-xs">{s.domain}</span>
                          <span className="text-[12px] text-tertiary">
                            {s.evidenceCount} 条 / {s.questionCount} 个问题
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-chart-2"
                            style={{ width: `${Math.max(4, (s.evidenceCount / max) * 100)}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-4 text-[12px] text-tertiary">
                说明：来源数量多不一定代表权威性高，也不代表这些来源一定影响其他搜索系统的回答。
              </p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-[15px] font-semibold">品牌匹配配置</h3>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">品牌名称</dt>
                  <dd>{brand.name}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">别名</dt>
                  <dd className="text-right">{brand.aliases.length > 0 ? brand.aliases.join("、") : "未配置"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">官网域名</dt>
                  <dd className="font-mono text-xs">{brand.websiteDomain ?? "未配置"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">关键词</dt>
                  <dd className="text-right">{brand.keywords.length > 0 ? brand.keywords.join("、") : "未配置"}</dd>
                </div>
              </dl>
              <p className="mt-3 text-[12px] text-tertiary">
                规则识别基于品牌名、别名与官网域名，匹配不确定的结果会进入人工复核队列，可在证据库中修正。
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-[15px] font-semibold">竞品对比（同口径）</h3>
              {competitors.length === 0 ? (
                <p className="mt-3 text-[13px] text-muted-foreground">尚未添加竞品。竞品出现率与本品牌使用相同分母。</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  <li className="flex items-center justify-between text-sm">
                    <span className="font-medium">{brand.name}（本品牌）</span>
                    <span className="text-muted-foreground">
                      {formatPercent(metrics.brandAppearance.value)} · 样本 {metrics.brandAppearance.validSamples}
                    </span>
                  </li>
                  {competitors.map((c) => (
                    <li key={c.competitorId} className="flex items-center justify-between text-sm">
                      <span>{c.name}</span>
                      <span className="text-muted-foreground">
                        {formatPercent(c.appearanceRate)} · 样本 {c.validSamples}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[12px] text-tertiary">
                「未检测到」仅表示本次样本中未出现，不代表该品牌在全网不存在或完全没有曝光。
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
