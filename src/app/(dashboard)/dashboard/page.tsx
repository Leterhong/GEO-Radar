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

  const [brands, credential, questionCount, taskCount, metrics, trend, sources, recentTasks, recentEvidence, recentReports, recentReviews, failedTasks] = await Promise.all([
    prisma.brand.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    prisma.searchProviderCredential.findUnique({ where: { workspaceId } }),
    prisma.question.count({ where: { workspaceId } }),
    prisma.searchTask.count({ where: { workspaceId } }),
    computeOverviewMetrics(workspaceId, brandId, days),
    brandId ? computeBrandTrend(workspaceId, brandId, days) : Promise.resolve([]),
    computeSourceDomains(workspaceId, brandId, days, 8),
    prisma.searchTask.findMany({
      where: { workspaceId, brandId: brandId ?? undefined },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { brand: { select: { name: true } }, creator: { select: { name: true } } },
    }),
    prisma.evidence.findMany({
      where: { workspaceId, brandId: brandId ?? undefined, isMock: false },
      orderBy: { collectedAt: "desc" },
      take: 6,
      select: { id: true, title: true, url: true, domain: true, collectedAt: true, mentionStatus: true },
    }),
    prisma.report.findMany({
      where: { workspaceId, brandId: brandId ?? undefined },
      orderBy: { generatedAt: "desc" },
      take: 4,
      select: { id: true, title: true, kind: true, generatedAt: true },
    }),
    prisma.evidenceReview.findMany({
      where: { workspaceId, ...(brandId ? { evidence: { brandId } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { id: true, action: true, createdAt: true, evidence: { select: { id: true, title: true } } },
    }),
    prisma.searchTask.findMany({
      where: { workspaceId, brandId: brandId ?? undefined, status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { id: true, name: true, failureReason: true, createdAt: true },
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

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          { label: "监测品牌", value: metrics.brandCount, href: "/brands" },
          { label: "竞品", value: metrics.competitorCount, href: "/competitors" },
          { label: "有效问题样本", value: metrics.brandAppearance.validSamples, href: "/matrix" },
          { label: "网页证据", value: metrics.evidenceCount, href: "/evidence" },
          { label: "最近采集", value: metrics.lastCollectedAt ? formatDate(metrics.lastCollectedAt) : "—", href: "/search-lab" },
          { label: "搜索任务", value: metrics.completedTasks, href: "/tasks" },
        ].map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-border-strong"
          >
            <p className="text-[11px] text-tertiary">{item.label}</p>
            <p className="mt-1 truncate text-lg font-semibold">{item.value}</p>
          </Link>
        ))}
      </div>

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
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
              sub={
                metrics.officialSiteCoverage.value === null
                  ? brandId
                    ? "请先在品牌设置中填写官网域名"
                    : "选择具体品牌后计算官网覆盖率"
                  : `有效样本 ${metrics.officialSiteCoverage.validSamples} 个问题`
              }
              methodology={metrics.officialSiteCoverage.methodology}
            />
            <KpiCard
              title="第三方页面覆盖率"
              value={formatPercent(metrics.thirdPartyCoverage.value)}
              sub={`有效样本 ${metrics.thirdPartyCoverage.validSamples} 个问题`}
              methodology={metrics.thirdPartyCoverage.methodology}
            />
            <KpiCard
              title="已完成搜索任务"
              value={String(metrics.completedTasks)}
              sub={`执行中 ${metrics.runningTasks} · 失败问题 ${metrics.failedItemTotal}`}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 text-[12px] text-muted-foreground">
            <span className="font-medium text-foreground">待处理</span>
            <Link href="/tasks" className="hover:underline">失败任务 {metrics.failedTaskCount}</Link>
            <Link href="/evidence" className="hover:underline">待复核证据 {metrics.pendingReviewCount}</Link>
            <Link href="/optimization" className="hover:underline">待处理优化 {metrics.pendingRecommendations}</Link>
            <Link href="/reports" className="hover:underline">报告 {metrics.reportCount}</Link>
            {failedTasks.length > 0 ? (
              <span className="truncate text-tertiary">最近失败：{failedTasks[0]?.name}</span>
            ) : null}
          </div>


          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <OverviewTrendChart data={trend} hasBrand={Boolean(brandId)} />
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

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-[15px] font-semibold">最近报告</h3>
                <Link href="/reports" className="text-xs text-primary hover:underline">
                  报告中心
                </Link>
              </div>
              {recentReports.length === 0 ? (
                <p className="mt-3 text-[13px] text-muted-foreground">暂无报告</p>
              ) : (
                <ul className="mt-3 divide-y">
                  {recentReports.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                      <Link href={`/reports/${r.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                        {r.title}
                      </Link>
                      <span className="shrink-0 text-[11px] text-tertiary">{formatDate(r.generatedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-[15px] font-semibold">最近人工复核</h3>
                <Link href="/evidence" className="text-xs text-primary hover:underline">
                  证据库
                </Link>
              </div>
              {recentReviews.length === 0 ? (
                <p className="mt-3 text-[13px] text-muted-foreground">暂无复核记录</p>
              ) : (
                <ul className="mt-3 divide-y">
                  {recentReviews.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                      <Link href={`/evidence/${r.evidence.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                        {r.evidence.title}
                      </Link>
                      <span className="shrink-0 text-[11px] text-tertiary">{r.action} · {formatDate(r.createdAt)}</span>
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
