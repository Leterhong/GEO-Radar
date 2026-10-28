import { requireWorkspace } from "@/server/auth/guard";
import { computeOverviewMetrics, computeBrandTrend, computeSourceDomains } from "@/server/services/metrics";
import { prisma } from "@/server/db/client";
import { PageHeader, KpiCard, EmptyState } from "@/components/shared/kpi-card";
import { TaskStatusBadge, MentionStatusBadge } from "@/components/shared/status-badges";
import { Button } from "@/components/ui/button";
import { formatDate, formatPercent } from "@/lib/utils";
import Link from "next/link";
import { OverviewTrendChart } from "@/components/dashboard/overview-trend-chart";
import { OverviewBrandFilter } from "@/components/dashboard/overview-brand-filter";
import { SetupGuide } from "@/components/shared/setup-guide";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: { brandId?: string; days?: string };
}) {
  const { workspaceId } = await requireWorkspace();
  const days = Math.min(365, Math.max(1, Number(searchParams.days ?? "30")));
  const brandId = searchParams.brandId || undefined;

  const [brands, credential, questionCount, taskCount, metrics, trend, sources, recentTasks, recentEvidence] = await Promise.all([
    prisma.brand.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    prisma.searchProviderCredential.findUnique({ where: { workspaceId } }),
    prisma.question.count({ where: { workspaceId } }),
    prisma.searchTask.count({ where: { workspaceId } }),
    computeOverviewMetrics(workspaceId, brandId, days),
    brandId ? computeBrandTrend(workspaceId, brandId, days) : Promise.resolve([]),
    computeSourceDomains(workspaceId, brandId, days, 8),
    prisma.searchTask.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { brand: { select: { name: true } }, creator: { select: { name: true } } },
    }),
    prisma.evidence.findMany({
      where: { workspaceId, isMock: false },
      orderBy: { collectedAt: "desc" },
      take: 6,
      select: { id: true, title: true, url: true, domain: true, collectedAt: true, mentionStatus: true },
    }),
  ]);

  const hasAnyData = metrics.brandAppearance.validSamples > 0 || recentTasks.length > 0;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="总览"
        description="品牌在真实搜索结果中的可见度概览。所有指标仅统计真实搜索数据，可查看计算口径与样本量。"
        actions={
          <>
            <OverviewBrandFilter brands={brands.map((b) => ({ id: b.id, name: b.name }))} days={days} />
            <Button asChild>
              <Link href="/search-lab">发起搜索</Link>
            </Button>
          </>
        }
      />

      {!hasAnyData ? (
        <div className="space-y-4">
          <SetupGuide
            state={{
              searchConfigured: credential?.status === "CONNECTED",
              questionCount,
              taskCount,
            }}
          />
          <EmptyState
            title="还没有可统计的搜索样本"
            description="指标只统计真实模式、状态成功的搜索问题；模拟任务与失败问题都不会进入分母。完成上面三步后，这里会出现品牌出现率、问题覆盖率和官网来源覆盖率。"
            className="bg-card"
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              title="品牌出现率"
              value={formatPercent(metrics.brandAppearance.value)}
              sub={`有效样本 ${metrics.brandAppearance.validSamples} 个问题`}
              methodology={metrics.brandAppearance.methodology}
            />
            <KpiCard
              title="问题覆盖率"
              value={formatPercent(metrics.questionCoverage.value)}
              sub={`有效样本 ${metrics.questionCoverage.validSamples} 个问题`}
              methodology={metrics.questionCoverage.methodology}
            />
            <KpiCard
              title="官网来源覆盖率"
              value={metrics.officialSiteCoverage.value === null ? "暂无数据" : formatPercent(metrics.officialSiteCoverage.value)}
              sub={metrics.officialSiteCoverage.value === null ? "请先在品牌设置中填写官网域名" : `有效样本 ${metrics.officialSiteCoverage.validSamples} 个问题`}
              methodology={metrics.officialSiteCoverage.methodology}
            />
            <KpiCard
              title="已完成搜索任务"
              value={String(metrics.completedTasks)}
              sub={`执行中 ${metrics.runningTasks} · 失败问题 ${metrics.failedItemTotal}`}
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <OverviewTrendChart data={trend} />
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-[15px] font-semibold">来源域名 Top 8</h3>
              {sources.length === 0 ? (
                <p className="mt-3 text-[13px] text-muted-foreground">暂无来源数据</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {sources.map((s) => (
                    <li key={s.domain} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-mono text-xs">{s.domain}</span>
                      <span className="shrink-0 text-muted-foreground">{s.evidenceCount} 条</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-[12px] text-tertiary">
                来源数量多不一定代表权威性高，也不代表一定能影响其他搜索系统的回答。
              </p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-[15px] font-semibold">最近搜索任务</h3>
                <Link href="/search-lab" className="text-xs text-primary hover:underline">
                  查看全部
                </Link>
              </div>
              {recentTasks.length === 0 ? (
                <p className="mt-3 text-[13px] text-muted-foreground">暂无任务</p>
              ) : (
                <ul className="mt-3 divide-y">
                  {recentTasks.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                      <Link href={`/search-lab/${t.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                        {t.name}
                        <span className="ml-2 text-[12px] text-tertiary">{t.brand?.name ?? "未关联品牌"}</span>
                      </Link>
                      <TaskStatusBadge status={t.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-[15px] font-semibold">最近发现的证据</h3>
                <Link href="/evidence" className="text-xs text-primary hover:underline">
                  证据库
                </Link>
              </div>
              {recentEvidence.length === 0 ? (
                <p className="mt-3 text-[13px] text-muted-foreground">暂无证据</p>
              ) : (
                <ul className="mt-3 divide-y">
                  {recentEvidence.map((e) => (
                    <li key={e.id} className="py-2">
                      <div className="flex items-center justify-between gap-2">
                        <a
                          href={e.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="min-w-0 flex-1 truncate text-sm hover:underline"
                          title={e.title}
                        >
                          {e.title}
                        </a>
                        <MentionStatusBadge status={e.mentionStatus} />
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[12px] text-tertiary">
                        {e.domain ?? "—"} · {formatDate(e.collectedAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold">待处理优化建议</h3>
              <Link href="/optimization" className="text-xs text-primary hover:underline">
                优化任务
              </Link>
            </div>
            <p className="mt-2 text-[13px] text-muted-foreground">
              当前有 <span className="font-medium text-foreground">{metrics.pendingRecommendations}</span> 条待处理 / 进行中的优化任务。
              优化建议由规则引擎基于可追溯证据生成，完成后可通过复测对比观察变化。
            </p>
          </div>
        </>
      )}
    </div>
  );
}
