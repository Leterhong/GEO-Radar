"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, InlineAlert, KpiCard, SectionTitle } from "@/components/shared/kpi-card";
import { formatDate } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ExternalLink,
  FileText,
  GitCompareArrows,
  History,
  Plus,
  RefreshCw,
} from "lucide-react";

interface TaskOption {
  id: string;
  name: string;
  brandId: string | null;
  brandName: string | null;
  status: string;
  executionMode: string;
  questionSetVersion: number | null;
  finishedAt: string | null;
  successItems: number;
  failedItems: number;
}

interface MetricSide {
  value: number | null;
  numerator: number;
  denominator: number;
  insufficient: boolean;
  smallSample: boolean;
}

interface ComparisonMetric {
  key: string;
  label: string;
  formulaVersion: string;
  definition: string;
  baseline: MetricSide;
  retest: MetricSide;
  delta: number | null;
  relativeChange: number | null;
  note: string | null;
}

interface CommonMetric {
  key: string;
  label: string;
  baseline: { numerator: number; denominator: number; value: number | null };
  retest: { numerator: number; denominator: number; value: number | null };
  delta: number | null;
}

interface QuestionChange {
  key: string;
  questionId: string | null;
  questionText: string;
  category: string;
  baselineState: string;
  retestState: string;
  change: string;
  baselineEvidenceIds: string[];
  retestEvidenceIds: string[];
  note: string | null;
}

interface Uncomparable {
  key: string;
  questionText: string;
  reason: string;
}

interface PageDiffItem {
  pageKey: string;
  url: string;
  title: string;
  domain: string | null;
  pageType: string;
  pageTypeLabel: string;
  sourceRole: string;
  questions: string[];
  evidenceId: string | null;
}

interface RoundSummary {
  taskId: string;
  name: string;
  status: string;
  executionMode: string;
  provider: string;
  questionSetVersion: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  counts: {
    totalQuestions: number;
    successItems: number;
    failedItems: number;
    emptyItems: number;
    cancelledItems: number;
    validQuestions: number;
    needsReviewEvidence: number;
    totalEvidence: number;
    uniquePages: number;
  };
  ruleVersion: string;
  brandName: string | null;
  dataSource: "SNAPSHOT" | "LIVE";
}

interface Comparison {
  version: string;
  baseline: RoundSummary;
  retest: RoundSummary;
  comparable: boolean;
  conditions: {
    sameBrand: boolean;
    sameProvider: boolean;
    sameExecutionMode: boolean;
    sameQuestionSetVersion: boolean;
    sameCollectParams: boolean;
    sameBrandConfig: boolean;
    parameterDifferences: Array<{ key: string; baseline: unknown; retest: unknown }>;
    warnings: string[];
  };
  metrics: ComparisonMetric[];
  commonSubset: { comparableQuestions: number; baselineValidQuestions: number; retestValidQuestions: number; metrics: CommonMetric[] };
  questions: {
    improved: QuestionChange[];
    declined: QuestionChange[];
    unchanged: QuestionChange[];
    newlyNeedsReview: QuestionChange[];
    uncomparable: Uncomparable[];
    totalCommon: number;
  };
  pageDiff: { newPages: PageDiffItem[]; disappearedPages: PageDiffItem[]; persistedPages: PageDiffItem[]; scope: string; truncated: boolean };
  consistency: { comparableQuestions: number; sameBrandStatus: number; sameBrandStatusRate: number | null };
  dataQuality: {
    baselineMissingRate: number | null;
    retestMissingRate: number | null;
    baselineFailedShare: number | null;
    retestFailedShare: number | null;
    baselineEmptyShare: number | null;
    retestEmptyShare: number | null;
    needsReviewEvidence: { baseline: number; retest: number };
  };
  volatility: {
    metric: string;
    rounds: number;
    points: Array<{ taskId: string; name: string; finishedAt: string | null; brandMentionRate: number | null; validQuestions: number; failedItems: number; emptyItems: number }>;
    observedMin: number | null;
    observedMax: number | null;
    observedMean: number | null;
    observedRange: number | null;
    intervalLabel: string;
    independentAssumptionNote: string;
    note: string;
  };
  optimizationEvents: Array<{ id: string; name: string; occurredAt: string; contentChanged: string | null; pageUrls: string[]; note: string | null; relation: string }>;
  limitations: string[];
  disclaimer: string;
}

function pct(value: number | null): string {
  return value === null ? "不可计算" : `${(value * 100).toFixed(1)}%`;
}

function deltaText(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)} 个百分点`;
}

function DeltaBadge({ value }: { value: number | null }) {
  if (value === null) return <Badge variant="muted">无法计算</Badge>;
  if (Math.abs(value) < 0.0005) return <Badge variant="muted">持平</Badge>;
  return value > 0 ? (
    <Badge variant="success">
      <ArrowUpRight className="mr-0.5 h-3 w-3" /> {deltaText(value)}
    </Badge>
  ) : (
    <Badge variant="destructive">
      <ArrowDownRight className="mr-0.5 h-3 w-3" /> {deltaText(value)}
    </Badge>
  );
}

function ConditionBadge({ ok, label }: { ok: boolean; label: string }) {
  return <Badge variant={ok ? "success" : "warning"}>{label}：{ok ? "一致" : "不一致"}</Badge>;
}

export function ComparisonClient({
  tasks,
  initialBaselineId,
  initialRetestId,
}: {
  tasks: TaskOption[];
  initialBaselineId?: string;
  initialRetestId?: string;
}) {
  const [baselineId, setBaselineId] = useState(initialBaselineId ?? tasks[1]?.id ?? "");
  const [retestId, setRetestId] = useState(initialRetestId ?? tasks[0]?.id ?? "");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [eventChange, setEventChange] = useState("");
  const [eventNote, setEventNote] = useState("");
  const [eventBusy, setEventBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);

  const load = useCallback(async () => {
    if (!baselineId || !retestId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/comparisons?baseline=${baselineId}&retest=${retestId}`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.error?.message ?? "比较失败");
        setComparison(null);
        return;
      }
      setComparison(json.data.comparison);
    } catch {
      setError("比较失败：网络或服务异常");
    } finally {
      setLoading(false);
    }
  }, [baselineId, retestId]);

  useEffect(() => {
    if (baselineId && retestId && baselineId !== retestId) void load();
  }, [baselineId, retestId, load]);

  const baselineTask = useMemo(() => tasks.find((t) => t.id === baselineId), [tasks, baselineId]);
  const retestTask = useMemo(() => tasks.find((t) => t.id === retestId), [tasks, retestId]);
  const brandId = retestTask?.brandId ?? baselineTask?.brandId ?? undefined;

  async function createEvent() {
    if (!eventName.trim()) {
      toast.error("请填写事件名称");
      return;
    }
    setEventBusy(true);
    try {
      const res = await fetch("/api/optimization-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          name: eventName.trim(),
          occurredAt: eventDate,
          contentChanged: eventChange.trim() || undefined,
          note: eventNote.trim() || undefined,
          baselineTaskId: baselineId,
          retestTaskId: retestId,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "记录失败");
        return;
      }
      toast.success("优化事件已记录（仅表示时间关联，不代表因果）");
      setEventName("");
      setEventChange("");
      setEventNote("");
      await load();
    } finally {
      setEventBusy(false);
    }
  }

  async function generateReport() {
    setReportBusy(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: retestId, compareTaskId: baselineId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "生成报告失败");
        return;
      }
      toast.success("对比报告已生成");
      window.location.href = `/reports/${json.data.id}`;
    } finally {
      setReportBusy(false);
    }
  }

  if (tasks.length < 2) {
    return (
      <EmptyState
        title="至少需要两轮已完成的采集任务"
        description="完成第一轮采集后，创建并执行复测任务，即可在这里比较共同问题、页面变化与数据质量。"
        action={
          <Button asChild>
            <Link href="/search-lab">前往搜索实验室</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="min-w-[240px] flex-1 space-y-1.5">
          <label className="text-[12px] text-secondary-soft">基线轮次（较早）</label>
          <Select value={baselineId} onValueChange={setBaselineId}>
            <SelectTrigger>
              <SelectValue placeholder="选择基线任务" />
            </SelectTrigger>
            <SelectContent>
              {tasks.map((task) => (
                <SelectItem key={task.id} value={task.id}>
                  {task.name}（{task.executionMode === "MOCK" ? "模拟" : "真实"} · {task.brandName ?? "未关联品牌"} · {task.finishedAt ? formatDate(task.finishedAt) : "—"}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ArrowRight className="mb-2 h-4 w-4 text-quaternary" />
        <div className="min-w-[240px] flex-1 space-y-1.5">
          <label className="text-[12px] text-secondary-soft">复测轮次（较新）</label>
          <Select value={retestId} onValueChange={setRetestId}>
            <SelectTrigger>
              <SelectValue placeholder="选择复测任务" />
            </SelectTrigger>
            <SelectContent>
              {tasks.map((task) => (
                <SelectItem key={task.id} value={task.id}>
                  {task.name}（{task.executionMode === "MOCK" ? "模拟" : "真实"} · {task.brandName ?? "未关联品牌"} · {task.finishedAt ? formatDate(task.finishedAt) : "—"}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading || !baselineId || !retestId}>
          <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> 重新比较
        </Button>
        <Button onClick={() => void generateReport()} disabled={reportBusy || !comparison}>
          <FileText className="mr-1 h-4 w-4" /> 生成对比报告
        </Button>
      </div>

      {baselineId === retestId ? <InlineAlert tone="warning">基线与复测不能是同一轮任务。</InlineAlert> : null}
      {error ? <InlineAlert tone="danger" title="无法比较">{error}</InlineAlert> : null}

      {loading && !comparison ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl border border-border bg-surface-muted" />
          ))}
        </div>
      ) : null}

      {comparison ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <KpiCard
              title="共同可比问题"
              value={String(comparison.questions.totalCommon)}
              sub={`基线有效 ${comparison.commonSubset.baselineValidQuestions} · 复测有效 ${comparison.commonSubset.retestValidQuestions}`}
              methodology="共同可比问题 = 两轮都成功执行、结果非空、问题文本一致的问题。仅这些问题上比较品牌出现状态变化。"
              accent="primary"
            />
            <KpiCard
              title="品牌状态一致性"
              value={pct(comparison.consistency.sameBrandStatusRate)}
              sub={`${comparison.consistency.sameBrandStatus} / ${comparison.consistency.comparableQuestions} 个问题两轮状态相同`}
              methodology="一致性 = 共同可比问题中，两轮品牌「是否被发现」状态相同的问题占比。一致性高说明波动较小，不代表结果正确。"
              accent="mint"
            />
            <KpiCard
              title="无法直接比较"
              value={String(comparison.questions.uncomparable.length)}
              sub="失败、空结果、仅单轮存在或问题文本变化"
              methodology="无法比较的问题单独列出，不强行纳入变化统计，也不当作品牌未出现。"
              accent="sand"
            />
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <SectionTitle title="对比条件" description="条件不一致会限制结论强度；指标定义保持同一版本。" />
            <div className="flex flex-wrap gap-2">
              <ConditionBadge ok={comparison.conditions.sameBrand} label="品牌" />
              <ConditionBadge ok={comparison.conditions.sameProvider} label="数据源" />
              <ConditionBadge ok={comparison.conditions.sameExecutionMode} label="执行模式" />
              <ConditionBadge ok={comparison.conditions.sameQuestionSetVersion} label="问题集版本" />
              <ConditionBadge ok={comparison.conditions.sameCollectParams} label="采集参数" />
              <ConditionBadge ok={comparison.conditions.sameBrandConfig} label="匹配配置" />
            </div>
            {comparison.conditions.parameterDifferences.length > 0 ? (
              <div className="mt-2 rounded-md bg-surface-muted px-3 py-2 text-[11px] text-tertiary">
                参数差异：
                {comparison.conditions.parameterDifferences
                  .map((d) => `${d.key}（${String(d.baseline ?? "未设置")} → ${String(d.retest ?? "未设置")}）`)
                  .join("；")}
              </div>
            ) : null}
            {comparison.conditions.warnings.map((warning, index) => (
              <p key={index} className="mt-1.5 text-[11px] text-warning">
                {warning}
              </p>
            ))}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-tertiary">
              <Badge variant={comparison.baseline.dataSource === "SNAPSHOT" ? "success" : "warning"}>
                数据来源：{comparison.baseline.dataSource === "SNAPSHOT" ? "采集快照" : "当前证据实时计算"}
              </Badge>
              <span>基线：{comparison.baseline.name}</span>
              <span>复测：{comparison.retest.name}</span>
              <span>基线完成：{comparison.baseline.finishedAt ? formatDate(comparison.baseline.finishedAt) : "—"}</span>
              <span>复测完成：{comparison.retest.finishedAt ? formatDate(comparison.retest.finishedAt) : "—"}</span>
            </div>
          </div>

          <div>
            <SectionTitle title="核心指标变化" description="每个指标都展示分子、分母与共同子集口径；失败/空结果不计入分母。" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {comparison.metrics.map((metric) => {
                const common = comparison.commonSubset.metrics.find((m) => m.key === metric.key);
                return (
                  <Card key={metric.key}>
                    <CardContent className="p-4">
                      <p className="text-[13px] font-medium text-tertiary">{metric.label}</p>
                      <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-[17px] font-semibold">{pct(metric.baseline.value)}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-quaternary" />
                        <span className="text-[17px] font-semibold">{pct(metric.retest.value)}</span>
                        <span className="ml-auto">
                          <DeltaBadge value={metric.delta} />
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11px] text-quaternary">
                        基线 {metric.baseline.numerator}/{metric.baseline.denominator} · 复测 {metric.retest.numerator}/{metric.retest.denominator}
                      </p>
                      {common ? (
                        <p className="mt-1 text-[11px] text-tertiary">
                          共同子集：{pct(common.baseline.value)} → {pct(common.retest.value)}（分母 {common.baseline.denominator}）
                        </p>
                      ) : null}
                      {metric.note ? <p className="mt-1 text-[11px] text-warning">{metric.note}</p> : null}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          <Tabs defaultValue="questions">
            <TabsList>
              <TabsTrigger value="questions">问题级变化</TabsTrigger>
              <TabsTrigger value="pages">页面变化</TabsTrigger>
              <TabsTrigger value="quality">数据质量</TabsTrigger>
              <TabsTrigger value="volatility">波动分析</TabsTrigger>
              <TabsTrigger value="events">优化事件</TabsTrigger>
            </TabsList>

            <TabsContent value="questions">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {[
                    { label: "提升", value: comparison.questions.improved.length, variant: "success" as const },
                    { label: "下降", value: comparison.questions.declined.length, variant: "destructive" as const },
                    { label: "持平", value: comparison.questions.unchanged.length, variant: "muted" as const },
                    { label: "新增待复核", value: comparison.questions.newlyNeedsReview.length, variant: "warning" as const },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-border bg-card p-4">
                      <p className="text-[12px] text-tertiary">{item.label}</p>
                      <p className="mt-1 text-xl font-semibold">{item.value}</p>
                    </div>
                  ))}
                </div>

                {(["declined", "improved", "newlyNeedsReview", "unchanged"] as const).map((group) => {
                  const rows = comparison.questions[group];
                  if (rows.length === 0) return null;
                  const labels = { declined: "品牌状态下降", improved: "品牌状态提升", newlyNeedsReview: "新增待复核", unchanged: "状态持平" };
                  return (
                    <div key={group} className="rounded-xl border border-border bg-card">
                      <div className="border-b border-border px-4 py-2.5 text-[12px] font-medium">{labels[group]}（{rows.length}）</div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>问题</TableHead>
                            <TableHead className="w-24">类别</TableHead>
                            <TableHead className="w-40">基线 → 复测</TableHead>
                            <TableHead className="w-40">证据</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((row) => (
                            <TableRow key={row.key}>
                              <TableCell className="text-[12px]">{row.questionText}</TableCell>
                              <TableCell className="text-[11px] text-tertiary">{row.category}</TableCell>
                              <TableCell className="text-[11px]">
                                {row.baselineState} → {row.retestState}
                              </TableCell>
                              <TableCell className="text-[11px]">
                                <div className="flex flex-wrap gap-2">
                                  {row.baselineEvidenceIds[0] ? (
                                    <Link href={`/evidence/${row.baselineEvidenceIds[0]}`} className="text-primary hover:underline">
                                      基线证据
                                    </Link>
                                  ) : null}
                                  {row.retestEvidenceIds[0] ? (
                                    <Link href={`/evidence/${row.retestEvidenceIds[0]}`} className="text-primary hover:underline">
                                      复测证据
                                    </Link>
                                  ) : null}
                                  {row.baselineEvidenceIds.length === 0 && row.retestEvidenceIds.length === 0 ? "—" : null}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  );
                })}

                {comparison.questions.uncomparable.length > 0 ? (
                  <div className="rounded-xl border border-warning/25 bg-warning-soft/40 p-4">
                    <SectionTitle title="无法直接比较的问题" description="这些问题的差异不计入变化结论。" />
                    <ul className="space-y-1 text-[12px] text-secondary-soft">
                      {comparison.questions.uncomparable.map((row) => (
                        <li key={row.key} className="flex flex-wrap gap-2">
                          <span>{row.questionText}</span>
                          <span className="text-warning">— {row.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </TabsContent>

            <TabsContent value="pages">
              <div className="space-y-4">
                <p className="text-[11px] text-tertiary">{comparison.pageDiff.scope}</p>
                {comparison.pageDiff.truncated ? <InlineAlert tone="info">页面列表已截断，仅展示前 200 个变化。</InlineAlert> : null}
                {(
                  [
                    { key: "newPages", label: "新出现的页面", tone: "success" as const },
                    { key: "disappearedPages", label: "本轮未再出现的页面", tone: "warning" as const },
                    { key: "persistedPages", label: "持续出现的页面", tone: "info" as const },
                  ] as const
                ).map((group) => {
                  const rows = comparison.pageDiff[group.key];
                  return (
                    <div key={group.key} className="rounded-xl border border-border bg-card">
                      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                        <span className="text-[12px] font-medium">{group.label}</span>
                        <Badge variant={group.tone}>{rows.length}</Badge>
                      </div>
                      {rows.length === 0 ? (
                        <p className="px-4 py-6 text-center text-[12px] text-tertiary">无</p>
                      ) : (
                        <div className="divide-y divide-border">
                          {rows.map((page) => (
                            <div key={page.pageKey} className="flex flex-wrap items-start gap-2 px-4 py-2.5">
                              <div className="min-w-0 flex-1">
                                <a
                                  href={page.url}
                                  target="_blank"
                                  rel="noopener noreferrer nofollow"
                                  className="line-clamp-1 text-[12px] font-medium hover:text-primary hover:underline"
                                >
                                  {page.title}
                                </a>
                                <p className="truncate font-mono text-[10px] text-quaternary">{page.domain}</p>
                                <p className="mt-0.5 line-clamp-1 text-[10px] text-tertiary">涉及问题：{page.questions.join("；")}</p>
                              </div>
                              <Badge variant="info" className="text-[10px]">{page.pageTypeLabel}</Badge>
                              <Badge variant="secondary" className="text-[10px]">{page.sourceRole === "OFFICIAL" ? "官网" : "第三方"}</Badge>
                              {page.evidenceId ? (
                                <Link href={`/evidence/${page.evidenceId}`} className="text-[11px] text-primary hover:underline">
                                  证据 <ExternalLink className="inline h-3 w-3" />
                                </Link>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </TabsContent>

            <TabsContent value="quality">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Card>
                  <CardContent className="p-4">
                    <SectionTitle title="数据缺失与失败" description="缺失率 =（失败 + 取消 + 空结果）÷ 问题总数。" />
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>指标</TableHead>
                          <TableHead>基线</TableHead>
                          <TableHead>复测</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[
                          { label: "缺失率", b: comparison.dataQuality.baselineMissingRate, r: comparison.dataQuality.retestMissingRate },
                          { label: "失败占比", b: comparison.dataQuality.baselineFailedShare, r: comparison.dataQuality.retestFailedShare },
                          { label: "空结果占比", b: comparison.dataQuality.baselineEmptyShare, r: comparison.dataQuality.retestEmptyShare },
                        ].map((row) => (
                          <TableRow key={row.label}>
                            <TableCell className="text-[12px]">{row.label}</TableCell>
                            <TableCell className="text-[12px]">{pct(row.b)}</TableCell>
                            <TableCell className="text-[12px]">{pct(row.r)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow>
                          <TableCell className="text-[12px]">待复核证据</TableCell>
                          <TableCell className="text-[12px]">{comparison.dataQuality.needsReviewEvidence.baseline}</TableCell>
                          <TableCell className="text-[12px]">{comparison.dataQuality.needsReviewEvidence.retest}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <SectionTitle title="样本量" description="分母不同会直接影响比例，对比时请同时看样本量。" />
                    <div className="space-y-2 text-[12px]">
                      <p>基线总问题 {comparison.baseline.counts.totalQuestions} · 有效 {comparison.baseline.counts.validQuestions} · 失败 {comparison.baseline.counts.failedItems} · 空结果 {comparison.baseline.counts.emptyItems}</p>
                      <p>复测总问题 {comparison.retest.counts.totalQuestions} · 有效 {comparison.retest.counts.validQuestions} · 失败 {comparison.retest.counts.failedItems} · 空结果 {comparison.retest.counts.emptyItems}</p>
                      <p className="text-tertiary">共同可比问题仅用于问题级状态变化；总体指标仍按各自有效样本计算。</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="volatility">
              <Card>
                <CardContent className="p-4">
                  <SectionTitle title="结果波动" description={comparison.volatility.intervalLabel} />
                  {comparison.volatility.rounds < 2 ? (
                    <InlineAlert tone="info" title="历史轮次不足">{comparison.volatility.note}</InlineAlert>
                  ) : (
                    <>
                      <div className="mb-3 grid grid-cols-1 gap-2 text-[12px] md:grid-cols-4">
                        <div className="rounded-md bg-surface-muted px-3 py-2">观测最小值：{pct(comparison.volatility.observedMin)}</div>
                        <div className="rounded-md bg-surface-muted px-3 py-2">观测最大值：{pct(comparison.volatility.observedMax)}</div>
                        <div className="rounded-md bg-surface-muted px-3 py-2">观测均值：{pct(comparison.volatility.observedMean)}</div>
                        <div className="rounded-md bg-surface-muted px-3 py-2">观测极差：{comparison.volatility.observedRange === null ? "—" : `${(comparison.volatility.observedRange * 100).toFixed(1)} 个百分点`}</div>
                      </div>
                      <div className="space-y-2">
                        {comparison.volatility.points.map((point) => (
                          <div key={point.taskId} className="flex items-center gap-3">
                            <span className="w-56 shrink-0 truncate text-[11px] text-tertiary" title={point.name}>
                              {point.name}
                            </span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                              <div className="h-full rounded-full bg-brand-blue" style={{ width: `${Math.max(2, (point.brandMentionRate ?? 0) * 100)}%` }} />
                            </div>
                            <span className="w-28 shrink-0 text-right font-mono text-[11px] text-tertiary">
                              {pct(point.brandMentionRate)} · n={point.validQuestions}
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="mt-3 text-[11px] leading-relaxed text-tertiary">{comparison.volatility.note}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-warning">{comparison.volatility.independentAssumptionNote}</p>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="events">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.1fr]">
                <Card>
                  <CardContent className="p-4">
                    <SectionTitle title="记录优化事件" description="记录内容/页面修改，供前后对比参考。前后相关不等于因果。" />
                    <div className="space-y-2.5">
                      <Input placeholder="事件名称，例如：产品页补充 FAQ" value={eventName} onChange={(e) => setEventName(e.target.value)} />
                      <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
                      <Textarea placeholder="修改内容（可选）" value={eventChange} onChange={(e) => setEventChange(e.target.value)} rows={3} />
                      <Textarea placeholder="操作备注（可选）" value={eventNote} onChange={(e) => setEventNote(e.target.value)} rows={2} />
                      <Button onClick={() => void createEvent()} disabled={eventBusy}>
                        <Plus className="mr-1 h-4 w-4" /> 记录事件
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <SectionTitle title="两轮之间的优化事件" description="仅表示时间上的关联，不能证明事件导致了指标变化。" />
                    {comparison.optimizationEvents.length === 0 ? (
                      <p className="py-6 text-center text-[12px] text-tertiary">两轮之间没有记录优化事件。</p>
                    ) : (
                      <ol className="space-y-2">
                        {comparison.optimizationEvents.map((event) => (
                          <li key={event.id} className="rounded-md border border-border px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[12px] font-medium">{event.name}</span>
                              <Badge variant="secondary" className="text-[9px]">{event.relation}</Badge>
                              <span className="ml-auto text-[10px] text-quaternary">{formatDate(event.occurredAt)}</span>
                            </div>
                            {event.contentChanged ? <p className="mt-1 text-[11px] text-secondary-soft">{event.contentChanged}</p> : null}
                            {event.pageUrls.length > 0 ? (
                              <p className="mt-1 truncate font-mono text-[10px] text-quaternary">{event.pageUrls.join("、")}</p>
                            ) : null}
                            {event.note ? <p className="mt-1 text-[11px] text-tertiary">{event.note}</p> : null}
                          </li>
                        ))}
                      </ol>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>

          <div className="rounded-xl border border-border bg-surface-subtle/60 p-4 text-[11px] leading-relaxed text-tertiary">
            <p className="flex items-center gap-1.5 font-medium text-secondary-soft">
              <AlertTriangle className="h-3.5 w-3.5 text-warning" /> 结论限制
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5">
              {comparison.limitations.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
            <p className="mt-2 flex items-start gap-1.5 text-warning">
              <History className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {comparison.disclaimer}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href={`/search-lab/${comparison.baseline.taskId}`}>查看基线详情（原始证据）</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/search-lab/${comparison.retest.taskId}`}>查看复测详情（原始证据）</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/matrix?brandId=${brandId ?? ""}`}>
                <GitCompareArrows className="mr-1 h-4 w-4" /> 品牌问题矩阵
              </Link>
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
