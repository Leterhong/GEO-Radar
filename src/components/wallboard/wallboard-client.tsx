"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPercent, formatDate } from "@/lib/utils";
import {
  Maximize,
  Minimize,
  RefreshCw,
  Radar,
  ArrowLeft,
  Timer,
  TimerOff,
} from "lucide-react";

interface WallboardData {
  metrics: {
    brandAppearance: { value: number | null; validSamples: number };
    questionCoverage: { value: number | null; validSamples: number };
    officialSiteCoverage: { value: number | null; validSamples: number };
    completedTasks: number;
    runningTasks: number;
    pendingRecommendations: number;
  };
  trend: Array<{ date: string; appearanceRate: number | null; validSamples: number }>;
  sources: Array<{ domain: string; evidenceCount: number; questionCount: number }>;
  competitors: Array<{ competitorId: string; name: string; appearanceRate: number | null; validSamples: number }>;
  latestTask: { id: string; name: string; status: string; finishedAt: string | null } | null;
  taskStats: Array<{ status: string; count: number }>;
  latestEvidence: Array<{ id: string; title: string; domain: string | null; collectedAt: string; mentionStatus: string }>;
  generatedAt: string;
  note: string;
}

const STATUS_LABEL: Record<string, string> = {
  QUEUED: "排队中",
  RUNNING: "执行中",
  COMPLETED: "已完成",
  PARTIAL_FAILED: "部分失败",
  FAILED: "失败",
  CANCELLED: "已取消",
};

export function WallboardClient({
  brands,
  workspaceName,
}: {
  brands: Array<{ id: string; name: string }>;
  workspaceName: string;
}) {
  const [brandId, setBrandId] = useState("all");
  const [days, setDays] = useState("30");
  const [data, setData] = useState<WallboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false); // 默认关闭
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days });
      if (brandId !== "all") params.set("brandId", brandId);
      const res = await fetch(`/api/wallboard?${params.toString()}`);
      const json = await res.json();
      if (json.ok) setData(json.data);
    } finally {
      setLoading(false);
    }
  }, [brandId, days]);

  useEffect(() => {
    void load();
  }, [load]);

  // 自动刷新只重新读取已保存数据，绝不触发搜索
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => void load(), 60000);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  async function toggleFullscreen() {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen().catch(() => undefined);
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen().catch(() => undefined);
      setIsFullscreen(false);
    }
  }

  const m = data?.metrics;

  return (
    <div ref={containerRef} className="min-h-screen bg-background p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Radar className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">GEO Radar 大屏</h1>
            <p className="text-[12px] text-tertiary">{workspaceName}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={brandId} onValueChange={setBrandId}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部品牌</SelectItem>
              {brands.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">近 7 天</SelectItem>
              <SelectItem value="30">近 30 天</SelectItem>
              <SelectItem value="90">近 90 天</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> 刷新
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAutoRefresh((v) => !v)}>
            {autoRefresh ? <Timer className="mr-1 h-3.5 w-3.5 text-success" /> : <TimerOff className="mr-1 h-3.5 w-3.5" />}
            自动刷新{autoRefresh ? "开" : "关"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void toggleFullscreen()}>
            {isFullscreen ? <Minimize className="mr-1 h-3.5 w-3.5" /> : <Maximize className="mr-1 h-3.5 w-3.5" />}
            {isFullscreen ? "退出全屏" : "全屏"}
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="mr-1 h-3.5 w-3.5" /> 返回
            </Link>
          </Button>
        </div>
      </header>

      {loading && !data ? (
        <div className="flex h-[80vh] items-center justify-center text-[13px] text-muted-foreground">加载数据中…</div>
      ) : !m || (m.brandAppearance.validSamples === 0 && data?.sources.length === 0) ? (
        <div className="flex h-[80vh] flex-col items-center justify-center gap-3 text-center">
          <Radar className="h-10 w-10 text-muted-foreground" />
          <p className="text-lg font-medium">暂无可展示的搜索数据</p>
          <p className="max-w-md text-[13px] text-muted-foreground">
            大屏只展示已保存的真实搜索数据，不会为了展示效果生成虚构数字。执行真实搜索任务后数据会出现在这里。
          </p>
          <p className="text-[12px] text-tertiary">{data?.note}</p>
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-4">
          {/* 第一行：核心指标 */}
          <div className="col-span-12 grid grid-cols-2 gap-4 lg:grid-cols-5">
            <WallKpi title="品牌出现率" value={formatPercent(m.brandAppearance.value)} sub={`样本 ${m.brandAppearance.validSamples}`} />
            <WallKpi title="问题覆盖率" value={formatPercent(m.questionCoverage.value)} sub={`样本 ${m.questionCoverage.validSamples}`} />
            <WallKpi
              title="官网来源覆盖率"
              value={m.officialSiteCoverage.value === null ? "暂无" : formatPercent(m.officialSiteCoverage.value)}
              sub={m.officialSiteCoverage.value === null ? "未配置官网域名" : `样本 ${m.officialSiteCoverage.validSamples}`}
            />
            <WallKpi title="已完成任务" value={String(m.completedTasks)} sub={m.runningTasks > 0 ? `执行中 ${m.runningTasks}` : "当前无执行中任务"} />
            <WallKpi title="待处理优化" value={String(m.pendingRecommendations)} sub="基于证据的规则建议" />
          </div>

          {/* 第二行：趋势 / 竞品对比 / 来源 Top10 */}
          <div className="col-span-12 rounded-xl border border-border bg-card p-4 lg:col-span-4">
            <WallTitle>品牌出现趋势</WallTitle>
            {data.trend.length === 0 ? (
              <WallEmpty />
            ) : (
              <ul className="mt-3 space-y-2">
                {data.trend.slice(-8).map((t) => (
                  <li key={t.date} className="flex items-center gap-3 text-xs">
                    <span className="w-20 shrink-0 font-mono text-muted-foreground">{t.date.slice(5)}</span>
                    <div className="h-2 flex-1 rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-chart-1"
                        style={{ width: `${Math.max(3, (t.appearanceRate ?? 0) * 100)}%` }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right font-mono">{formatPercent(t.appearanceRate)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="col-span-12 rounded-xl border border-border bg-card p-4 lg:col-span-4">
            <WallTitle>品牌 vs 竞品</WallTitle>
            {data.competitors.length === 0 ? (
              <WallEmpty text="尚未添加竞品或无样本" />
            ) : (
              <ul className="mt-3 space-y-3">
                {data.competitors.slice(0, 5).map((c) => (
                  <li key={c.competitorId} className="text-xs">
                    <div className="flex items-center justify-between">
                      <span>{c.name}</span>
                      <span className="font-mono text-muted-foreground">
                        {formatPercent(c.appearanceRate)}（{c.validSamples}）
                      </span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-muted">
                      <div className="h-full rounded-full bg-chart-2" style={{ width: `${Math.max(3, (c.appearanceRate ?? 0) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="col-span-12 rounded-xl border border-border bg-card p-4 lg:col-span-4">
            <WallTitle>来源域名 Top 10</WallTitle>
            {data.sources.length === 0 ? (
              <WallEmpty />
            ) : (
              <ol className="mt-3 space-y-1.5">
                {data.sources.map((s, i) => (
                  <li key={s.domain} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate font-mono">
                      <span className="mr-1.5 text-muted-foreground">{i + 1}.</span>
                      {s.domain}
                    </span>
                    <span className="shrink-0 text-muted-foreground">{s.evidenceCount} 条</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* 第三行：任务状态 / 最新证据 */}
          <div className="col-span-12 rounded-xl border border-border bg-card p-4 lg:col-span-5">
            <WallTitle>搜索任务</WallTitle>
            <div className="mt-3 flex flex-wrap gap-2">
              {data.taskStats.length === 0 ? (
                <span className="text-[12px] text-tertiary">暂无任务</span>
              ) : (
                data.taskStats.map((t) => (
                  <span key={t.status} className="rounded-md border px-2.5 py-1 text-xs">
                    {STATUS_LABEL[t.status] ?? t.status}
                    <span className="ml-1.5 font-mono font-medium">{t.count}</span>
                  </span>
                ))
              )}
            </div>
            {data.latestTask ? (
              <p className="mt-3 text-[12px] text-tertiary">
                最近任务：{data.latestTask.name} · {STATUS_LABEL[data.latestTask.status] ?? data.latestTask.status}
                {data.latestTask.finishedAt ? ` · ${formatDate(data.latestTask.finishedAt)}` : ""}
              </p>
            ) : null}
          </div>
          <div className="col-span-12 rounded-xl border border-border bg-card p-4 lg:col-span-7">
            <WallTitle>最新证据</WallTitle>
            {data.latestEvidence.length === 0 ? (
              <WallEmpty />
            ) : (
              <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                {data.latestEvidence.slice(0, 4).map((e) => (
                  <li key={e.id} className="rounded-md border px-3 py-2">
                    <p className="line-clamp-1 text-xs font-medium">{e.title}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      {e.domain ?? "—"} · {formatDate(e.collectedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <footer className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>数据更新时间：{data ? formatDate(data.generatedAt) : "—"}（只读已保存数据，刷新不会触发搜索）</span>
        <span>GEO Radar · 用可追溯的搜索证据，看见品牌在搜索中的真实位置</span>
      </footer>
    </div>
  );
}

function WallKpi({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[12px] text-tertiary">{title}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function WallTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold">{children}</h2>;
}

function WallEmpty({ text }: { text?: string }) {
  return <p className="mt-4 text-[12px] text-tertiary">{text ?? "暂无数据（不会生成虚构曲线）"}</p>;
}
