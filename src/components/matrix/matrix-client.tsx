"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, InlineAlert, KpiCard, SectionTitle } from "@/components/shared/kpi-card";
import { TaskStatusBadge, MockBadge } from "@/components/shared/status-badges";
import { formatDate } from "@/lib/utils";
import { ArrowUpRight, BarChart3, ExternalLink, Filter, Info, RefreshCw, Search } from "lucide-react";

interface Brand {
  id: string;
  name: string;
}

interface RoundRow {
  id: string;
  name: string;
  brandName: string | null;
  status: string;
  executionMode: string;
  source: string;
  questionSetVersion: number | null;
  totalItems: number;
  successItems: number;
  failedItems: number;
  emptyItems: number;
  finishedAt: string | null;
  createdAt: string;
}

interface MetricRow {
  key: string;
  label: string;
  value: number | null;
  numerator: number;
  denominator: number;
  formulaVersion: string;
  definition: string;
  sampleScope: string;
  notes: string;
  insufficient: boolean;
  notConfigured?: boolean;
  smallSample: boolean;
  sampleStatus: string;
  breakdown?: unknown;
}

interface EvidenceRow {
  id: string;
  questionId: string | null;
  itemId: string | null;
  title: string;
  url: string;
  domain: string | null;
  snippet: string | null;
  pageType: string;
  pageTypeRule: string | null;
  sourceRole: string;
  mentionStatus: string;
  detectionMethod: string;
  brandMatchBasis: string[];
  matchedTerms: string[];
  competitorMatches: string[];
  officialDomainMatch: boolean;
  thirdPartyMention: boolean;
  relevance: string;
  collectedAt: string;
}

interface CellRow {
  entityKey: string;
  state: string;
  found: boolean;
  officialPageFound: boolean;
  thirdPartyPageFound: boolean;
  pageCount: number;
  evidenceCount: number;
  needsReview: boolean;
  lastCollectedAt: string | null;
  evidenceIds: string[];
  pageUrls: string[];
}

interface QuestionRow {
  key: string;
  itemId: string;
  questionId: string | null;
  questionText: string;
  category: string;
  itemStatus: string;
  state: string;
  resultCount: number;
  parseErrorCount: number;
  executedAt: string | null;
  cells: CellRow[];
}

interface EntityRow {
  key: string;
  kind: "BRAND" | "COMPETITOR";
  id: string;
  name: string;
  websiteDomain: string | null;
}

interface Dataset {
  task: {
    id: string;
    name: string;
    brandName: string | null;
    executionMode: string;
    provider: string;
    status: string;
    questionSetVersion: number | null;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
    isMock: boolean;
  };
  brand: { id: string; name: string; websiteDomain: string | null } | null;
  entities: EntityRow[];
  questions: QuestionRow[];
  evidence: EvidenceRow[];
  metrics: MetricRow[];
  pageTypeDistribution: Array<{ pageType: string; label: string; count: number; share: number | null }>;
  counts: {
    totalQuestions: number;
    successItems: number;
    failedItems: number;
    emptyItems: number;
    cancelledItems: number;
    notExecutedItems: number;
    parseErrorItems: number;
    validQuestions: number;
    needsReviewEvidence: number;
    totalEvidence: number;
    uniquePages: number;
  };
  limitations: string[];
  ruleVersion: string;
}

interface MatrixResponse {
  dataset: Dataset | null;
  rounds: RoundRow[];
  message?: string;
  labels: { pageTypes: Record<string, string>; cellStates: Record<string, string> };
}

const CELL_STYLES: Record<string, string> = {
  FOUND: "border-success/30 bg-success-soft text-success",
  NOT_FOUND: "border-border bg-surface-muted text-tertiary",
  TASK_FAILED: "border-destructive/30 bg-destructive/8 text-destructive",
  EMPTY: "border-border-strong bg-info-soft text-primary-strong",
  NOT_COLLECTED: "border-dashed border-border bg-transparent text-quaternary",
  NEEDS_REVIEW: "border-warning/30 bg-warning-soft text-warning",
};

function formatPercent(value: number | null): string {
  return value === null ? "不可计算" : `${(value * 100).toFixed(1)}%`;
}

function cellSummary(cell: CellRow | undefined, entity: EntityRow): string {
  if (!cell) return "—";
  if (cell.state === "FOUND") {
    return `${cell.pageCount} 页 / ${cell.evidenceCount} 证据${cell.officialPageFound ? " · 官网" : ""}${cell.thirdPartyPageFound ? " · 第三方" : ""}`;
  }
  if (cell.state === "NOT_FOUND") return `未发现${entity.kind === "BRAND" ? "品牌" : "竞品"}`;
  return "";
}

export function MatrixClient({
  brands,
  initialBrandId,
  initialIncludeMock = false,
}: {
  brands: Brand[];
  initialBrandId?: string;
  initialIncludeMock?: boolean;
}) {
  const [brandId, setBrandId] = useState(
    initialBrandId && brands.some((b) => b.id === initialBrandId) ? initialBrandId : brands[0]?.id ?? ""
  );
  const [taskId, setTaskId] = useState("");
  const [includeMock, setIncludeMock] = useState(initialIncludeMock);
  const [data, setData] = useState<MatrixResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "found" | "missing" | "review" | "failed">("all");
  const [category, setCategory] = useState<string>("all");
  const [grouped, setGrouped] = useState(true);
  const [selected, setSelected] = useState<{ question: QuestionRow; entity: EntityRow; cell: CellRow | undefined } | null>(null);
  const [metricDetail, setMetricDetail] = useState<MetricRow | null>(null);

  const load = useCallback(
    async (overrideTaskId?: string) => {
      if (!brandId && !overrideTaskId) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (brandId) params.set("brandId", brandId);
        if (overrideTaskId) params.set("taskId", overrideTaskId);
        if (includeMock) params.set("includeMock", "true");
        const res = await fetch(`/api/matrix?${params.toString()}`);
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json?.error?.message ?? "矩阵加载失败");
          setData(null);
          return;
        }
        setData(json.data);
        setTaskId(json.data?.dataset?.task.id ?? "");
        if (json.data?.dataset?.task.id) {
          const url = new URL(window.location.href);
          url.searchParams.set("brandId", brandId);
          url.searchParams.set("taskId", json.data.dataset.task.id);
          window.history.replaceState(null, "", url.toString());
        }
      } catch {
        setError("矩阵加载失败：网络或服务异常");
      } finally {
        setLoading(false);
      }
    },
    [brandId, includeMock]
  );

  useEffect(() => {
    if (!brandId) return;
    void load();
    // 仅在品牌/模式变化时自动加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, includeMock]);

  const dataset = data?.dataset ?? null;
  const brandEntity = dataset?.entities.find((e) => e.kind === "BRAND");
  const competitors = dataset?.entities.filter((e) => e.kind === "COMPETITOR") ?? [];

  const categories = useMemo(
    () => Array.from(new Set((dataset?.questions ?? []).map((q) => q.category))).sort((a, b) => a.localeCompare(b)),
    [dataset]
  );

  const filteredQuestions = useMemo(() => {
    if (!dataset) return [];
    return dataset.questions.filter((q) => {
      if (category !== "all" && q.category !== category) return false;
      const brandCell = brandEntity ? q.cells.find((c) => c.entityKey === brandEntity.key) : undefined;
      if (filter === "found") return brandCell?.found === true;
      if (filter === "missing") return brandCell?.state === "NOT_FOUND";
      if (filter === "review") return brandCell?.state === "NEEDS_REVIEW";
      if (filter === "failed") return q.state === "TASK_FAILED" || q.state === "EMPTY";
      return true;
    });
  }, [dataset, category, filter, brandEntity]);

  const groupedRows = useMemo(() => {
    if (!grouped) return [{ category: null as string | null, questions: filteredQuestions }];
    const map = new Map<string, QuestionRow[]>();
    for (const q of filteredQuestions) {
      map.set(q.category, [...(map.get(q.category) ?? []), q]);
    }
    return Array.from(map.entries()).map(([cat, questions]) => ({ category: cat, questions }));
  }, [filteredQuestions, grouped]);

  const evidenceById = useMemo(() => {
    const map = new Map<string, EvidenceRow>();
    for (const ev of dataset?.evidence ?? []) map.set(ev.id, ev);
    return map;
  }, [dataset]);

  const brandMetrics = useMemo(
    () => (dataset?.metrics ?? []).filter((m) => !m.key.startsWith("competitor_mention_question_rate:")),
    [dataset]
  );
  const competitorMetrics = useMemo(
    () => (dataset?.metrics ?? []).filter((m) => m.key.startsWith("competitor_mention_question_rate:")),
    [dataset]
  );

  function openCell(question: QuestionRow, entity: EntityRow) {
    setSelected({ question, entity, cell: question.cells.find((c) => c.entityKey === entity.key) });
  }

  const dialogEvidence = useMemo(() => {
    if (!selected || !dataset) return [];
    if (selected.cell?.evidenceIds.length) {
      return selected.cell.evidenceIds.map((id) => evidenceById.get(id)).filter((e): e is EvidenceRow => Boolean(e));
    }
    // 未发现品牌时也允许查看该问题原始结果
    return dataset.evidence.filter((e) => e.itemId === selected.question.itemId);
  }, [selected, dataset, evidenceById]);

  if (brands.length === 0) {
    return (
      <EmptyState
        title="还没有品牌档案"
        description="品牌问题矩阵需要先配置目标品牌与竞品。创建品牌后，执行一次真实搜索任务即可生成矩阵。"
        action={
          <Button asChild>
            <Link href="/brands">去创建品牌</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="min-w-[190px] space-y-1.5">
          <label className="text-[12px] text-secondary-soft">目标品牌</label>
          <Select
            value={brandId}
            onValueChange={(value) => {
              setBrandId(value);
              setTaskId("");
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择品牌" />
            </SelectTrigger>
            <SelectContent>
              {brands.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[280px] flex-1 space-y-1.5">
          <label className="text-[12px] text-secondary-soft">采集轮次</label>
          <Select
            value={taskId || "latest"}
            onValueChange={(value) => {
              if (value === "latest") {
                setTaskId("");
                void load();
              } else {
                setTaskId(value);
                void load(value);
              }
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="最近一次有效任务" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">最近一次有效任务（自动）</SelectItem>
              {(data?.rounds ?? []).map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}（{r.executionMode === "MOCK" ? "模拟" : "真实"} · {r.finishedAt ? formatDate(r.finishedAt) : "未完成"}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-[12px] text-tertiary">
          <input type="checkbox" checked={includeMock} onChange={(e) => setIncludeMock(e.target.checked)} />
          包含模拟任务（默认仅真实数据）
        </label>
        <Button variant="outline" onClick={() => void load(taskId || undefined)} disabled={loading}>
          <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> 刷新
        </Button>
        <Button variant="ghost" asChild>
          <Link href={`/search-lab?brandId=${brandId}`}>
            <Search className="mr-1 h-4 w-4" /> 发起采集
          </Link>
        </Button>
      </div>

      {error ? <InlineAlert tone="danger" title="加载失败">{error}</InlineAlert> : null}
      {loading && !dataset ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-border bg-surface-muted" />
          ))}
        </div>
      ) : null}

      {!loading && !dataset ? (
        <EmptyState
          title="暂无可分析的采集轮次"
          description={data?.message ?? "该品牌还没有成功返回结果的真实任务。请先执行一次搜索任务，任务完成后会自动生成采集快照与矩阵。"}
          action={
            <Button asChild>
              <Link href={`/search-lab?brandId=${brandId}`}>去发起搜索任务</Link>
            </Button>
          }
        />
      ) : null}

      {dataset ? (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-[12px]">
            <TaskStatusBadge status={dataset.task.status as never} />
            <MockBadge isMock={dataset.task.isMock} />
            <span className="font-medium text-[color:var(--text-primary)]">{dataset.task.name}</span>
            <span className="text-tertiary">问题集版本 v{dataset.task.questionSetVersion ?? "未知"}</span>
            <span className="text-tertiary">· 规则 {dataset.ruleVersion}</span>
            <span className="text-tertiary">· 完成 {dataset.task.finishedAt ? formatDate(dataset.task.finishedAt) : "—"}</span>
            <span className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" variant="outline" asChild>
                <Link href={`/search-lab/${dataset.task.id}`}>任务详情</Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/snapshots?taskId=${dataset.task.id}`}>历史快照</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href={`/reports?taskId=${dataset.task.id}`}>
                  <BarChart3 className="mr-1 h-3.5 w-3.5" /> 生成报告
                </Link>
              </Button>
            </span>
          </div>

          {dataset.task.isMock ? (
            <InlineAlert tone="warning" title="模拟数据">
              本任务为模拟模式，结果仅用于流程演示，不会进入真实统计。
            </InlineAlert>
          ) : null}
          {dataset.counts.failedItems > 0 ? (
            <InlineAlert tone="warning" title="部分问题执行失败">
              失败 {dataset.counts.failedItems} 个、空结果 {dataset.counts.emptyItems} 个；它们未计入指标分母，也未被当作「品牌未出现」。点击对应单元格可查看说明。
            </InlineAlert>
          ) : null}
          {dataset.counts.needsReviewEvidence > 0 ? (
            <InlineAlert tone="info" title="存在待复核证据">
              {dataset.counts.needsReviewEvidence} 条证据需要人工复核，当前不计入「已确认提及」。可在证据详情中确认或驳回。
            </InlineAlert>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              title="有效问题（分母）"
              value={String(dataset.counts.validQuestions)}
              sub={`总问题 ${dataset.counts.totalQuestions} · 成功 ${dataset.counts.successItems} · 失败 ${dataset.counts.failedItems} · 空结果 ${dataset.counts.emptyItems}`}
              methodology="有效问题 = 执行成功且至少返回 1 条结果。失败、取消、空结果、未执行不计入分母。"
              accent="primary"
            />
            <KpiCard
              title="本轮页面证据"
              value={String(dataset.counts.totalEvidence)}
              sub={`品牌相关去重页面 ${dataset.counts.uniquePages} · 待复核 ${dataset.counts.needsReviewEvidence}`}
              methodology="证据为页面级分析结果；原始搜索结果保存在任务详情中，二者分离。"
              accent="mint"
            />
            <KpiCard
              title="品牌问题矩阵"
              value={`${dataset.questions.length} × ${dataset.entities.length}`}
              sub={`${dataset.entities.length} 个实体（品牌 + 竞品）`}
              methodology="横轴为问题，纵轴为品牌与竞品；每个单元格可下钻查看原始证据。"
              accent="cyan"
            />
            <KpiCard
              title="页面类型"
              value={String(dataset.pageTypeDistribution.length)}
              sub={dataset.pageTypeDistribution
                .slice(0, 3)
                .map((p) => `${p.label} ${p.count}`)
                .join(" · ") || "暂无页面"}
              methodology="页面类型由可解释规则产生，无法可靠识别时标记为未知/其他，可人工修正。"
              accent="violet"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {brandMetrics
              .filter((m) => m.key !== "page_type_distribution" && m.key !== "category_coverage")
              .map((metric) => (
                <Card key={metric.key}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] font-medium text-tertiary">{metric.label}</p>
                      <button
                        type="button"
                        onClick={() => setMetricDetail(metric)}
                        className="inline-flex items-center gap-1 text-[10px] text-quaternary hover:text-primary"
                        aria-label="查看口径"
                      >
                        <Info className="h-3 w-3" /> 口径
                      </button>
                    </div>
                    <p className="mt-1.5 text-[24px] font-semibold leading-none">
                      {metric.notConfigured ? "未配置官网" : metric.insufficient ? "样本不足" : formatPercent(metric.value)}
                    </p>
                    <p className="mt-1.5 text-[11px] text-quaternary">
                      分子 {metric.numerator} / 分母 {metric.denominator}
                      {metric.smallSample ? " · 样本 < 5" : ""}
                    </p>
                    {metric.breakdown && metric.key === "brand_mention_question_rate" && typeof metric.breakdown === "object" ? (
                      <p className="mt-2 text-[11px] text-tertiary">
                        待复核问题 {String((metric.breakdown as { needsReviewQuestions?: number }).needsReviewQuestions ?? 0)} 个
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
          </div>

          {competitorMetrics.length > 0 ? (
            <div className="rounded-xl border border-border bg-card p-4">
              <SectionTitle title="竞品同口径指标" description="与品牌提及问题率使用同一分母与匹配规则。" />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {competitorMetrics.map((m) => (
                  <div key={m.key} className="rounded-lg border border-border px-3 py-2.5">
                    <p className="text-[12px] text-tertiary">{m.label}</p>
                    <p className="mt-1 text-lg font-semibold">{m.insufficient ? "样本不足" : formatPercent(m.value)}</p>
                    <p className="text-[11px] text-quaternary">
                      分子 {m.numerator} / 分母 {m.denominator}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <SectionTitle title="品牌问题矩阵" description="点击单元格查看该问题下的证据与原始结果；失败/空结果不会显示为「未发现」。" className="mb-0" />
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-quaternary" />
                <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
                  <SelectTrigger className="h-8 w-[132px] text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部问题</SelectItem>
                    <SelectItem value="found">已发现品牌</SelectItem>
                    <SelectItem value="missing">未发现品牌</SelectItem>
                    <SelectItem value="review">需要复核</SelectItem>
                    <SelectItem value="failed">失败/空结果</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="h-8 w-[132px] text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部类别</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-1.5 text-[12px] text-tertiary">
                  <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
                  按类别分组
                </label>
              </div>
            </div>

            {filteredQuestions.length === 0 ? (
              <p className="px-4 py-12 text-center text-[12px] text-tertiary">当前筛选条件下没有问题。</p>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[980px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-10 min-w-[280px] bg-card">问题</TableHead>
                      <TableHead className="w-24">问题状态</TableHead>
                      {dataset.entities.map((entity) => (
                        <TableHead key={entity.key} className="min-w-[150px]">
                          <span className="flex items-center gap-1.5">
                            {entity.name}
                            <Badge variant={entity.kind === "BRAND" ? "info" : "secondary"} className="text-[9px]">
                              {entity.kind === "BRAND" ? "本品牌" : "竞品"}
                            </Badge>
                          </span>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupedRows.map((group) => (
                      <Fragment key={group.category ?? "all"}>
                        {group.category ? (
                          <TableRow>
                            <TableCell colSpan={2 + dataset.entities.length} className="bg-surface-subtle/70 py-1.5 text-[11px] font-medium text-tertiary">
                              {group.category}（{group.questions.length} 个问题）
                            </TableCell>
                          </TableRow>
                        ) : null}
                        {group.questions.map((question) => (
                          <TableRow key={question.key}>
                            <TableCell className="sticky left-0 z-10 bg-card align-top">
                              <p className="line-clamp-2 text-[13px] font-medium">{question.questionText}</p>
                              <p className="mt-0.5 text-[11px] text-quaternary">
                                {question.resultCount} 条结果
                                {question.parseErrorCount > 0 ? ` · ${question.parseErrorCount} 条解析异常` : ""}
                                {question.executedAt ? ` · ${formatDate(question.executedAt)}` : ""}
                              </p>
                            </TableCell>
                            <TableCell className="align-top">
                              <Badge
                                variant={
                                  question.state === "FOUND"
                                    ? "success"
                                    : question.state === "TASK_FAILED"
                                      ? "destructive"
                                      : question.state === "NEEDS_REVIEW"
                                        ? "warning"
                                        : "muted"
                                }
                              >
                                {data?.labels.cellStates[question.state] ?? question.state}
                              </Badge>
                            </TableCell>
                            {dataset.entities.map((entity) => {
                              const cell = question.cells.find((c) => c.entityKey === entity.key);
                              const state = cell?.state ?? "NOT_COLLECTED";
                              const summary = cellSummary(cell, entity);
                              return (
                                <TableCell key={entity.key} className="align-top">
                                  <button
                                    type="button"
                                    onClick={() => openCell(question, entity)}
                                    className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors hover:brightness-[0.99] ${CELL_STYLES[state] ?? CELL_STYLES.NOT_COLLECTED}`}
                                  >
                                    <span className="block text-[11px] font-medium">
                                      {data?.labels.cellStates[state] ?? state}
                                    </span>
                                    {summary ? <span className="mt-0.5 block text-[10px] opacity-80">{summary}</span> : null}
                                    {cell?.state === "NOT_FOUND" ? (
                                      <span className="mt-0.5 flex items-center gap-1 text-[10px] opacity-70">
                                        查看原始结果 <ArrowUpRight className="h-2.5 w-2.5" />
                                      </span>
                                    ) : null}
                                  </button>
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="p-5">
                <SectionTitle title="页面类型分布" description={`品牌相关证据按规范化 URL 去重后共 ${dataset.counts.uniquePages} 个页面。`} />
                {dataset.pageTypeDistribution.length === 0 ? (
                  <p className="py-6 text-center text-[12px] text-tertiary">暂无品牌相关页面。</p>
                ) : (
                  <div className="space-y-2.5">
                    {dataset.pageTypeDistribution.map((row) => (
                      <div key={row.pageType}>
                        <div className="flex items-center justify-between text-[12px]">
                          <span className="text-secondary-soft">{row.label}</span>
                          <span className="font-mono text-[11px] text-tertiary">
                            {row.count} · {formatPercent(row.share)}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                          <div
                            className="h-full rounded-full bg-brand-blue"
                            style={{ width: `${Math.max(2, (row.share ?? 0) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <SectionTitle title="问题类别覆盖" description="按任务创建时的问题类别快照分组。" />
                {(() => {
                  const metric = dataset.metrics.find((m) => m.key === "category_coverage");
                  const rows = Array.isArray(metric?.breakdown)
                    ? (metric?.breakdown as Array<{ category: string; validQuestions: number; brandAppeared: number; rate: number | null }>)
                    : [];
                  if (rows.length === 0) return <p className="py-6 text-center text-[12px] text-tertiary">暂无类别数据。</p>;
                  return (
                    <div className="space-y-2">
                      {rows.map((row) => (
                        <div key={row.category} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                          <span className="min-w-0 flex-1 truncate text-[12px] text-secondary-soft">{row.category}</span>
                          <span className="font-mono text-[11px] text-tertiary">
                            {row.brandAppeared}/{row.validQuestions}
                          </span>
                          <Badge variant={row.rate === null ? "muted" : row.rate >= 0.5 ? "success" : "warning"}>
                            {formatPercent(row.rate)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </div>

          <div className="rounded-xl border border-border bg-surface-subtle/60 p-4 text-[11px] leading-relaxed text-tertiary">
            <p className="font-medium text-secondary-soft">口径与限制</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5">
              {dataset.limitations.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
              <li>本页指标只反映本轮搜索返回的网页结果，不代表所有 AI 平台的综合可见性，也不等同于最终生成式回答的引用。</li>
            </ul>
          </div>
        </>
      ) : null}

      {/* 单元格证据 */}
      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {selected?.entity.name} · {selected ? data?.labels.cellStates[selected.cell?.state ?? "NOT_COLLECTED"] : ""}
            </DialogTitle>
            <DialogDescription className="line-clamp-2">{selected?.question.questionText}</DialogDescription>
          </DialogHeader>
          {selected?.cell?.state === "TASK_FAILED" ? (
            <InlineAlert tone="danger" title="任务失败">
              该问题执行失败，不能当作「品牌未出现」。请到任务详情查看错误分类与 RequestId，修复后重试或复测。
            </InlineAlert>
          ) : selected?.cell?.state === "EMPTY" ? (
            <InlineAlert tone="warning" title="结果为空">
              该问题执行成功但返回 0 条结果。空结果不计入指标分母，也不能据此判断品牌未出现。
            </InlineAlert>
          ) : selected?.cell?.state === "NOT_COLLECTED" ? (
            <InlineAlert tone="info" title="尚未采集">
              该问题还没有执行记录。
            </InlineAlert>
          ) : dialogEvidence.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-tertiary">该问题没有关联结果。</p>
          ) : (
            <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {selected?.cell?.state === "NOT_FOUND" ? (
                <p className="rounded-md border border-border bg-surface-muted px-3 py-2 text-[11px] text-tertiary">
                  未匹配到该实体。以下是该问题的原始搜索结果，供人工核查，不代表品牌一定不存在。
                </p>
              ) : null}
              {dialogEvidence.map((ev) => (
                <div key={ev.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium">{ev.title}</p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-tertiary">{ev.domain ?? "—"}</p>
                    </div>
                    <Badge variant="muted">{data?.labels.pageTypes[ev.pageType] ?? ev.pageType}</Badge>
                  </div>
                  {ev.snippet ? <p className="mt-1.5 line-clamp-3 text-[12px] text-muted-foreground">{ev.snippet}</p> : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="text-quaternary">匹配依据：{ev.brandMatchBasis.join("、") || "—"}</span>
                    {ev.officialDomainMatch ? <Badge variant="success">官网</Badge> : null}
                    {ev.thirdPartyMention ? <Badge variant="secondary">第三方提及</Badge> : null}
                    {ev.competitorMatches.length > 0 ? <Badge variant="muted">竞品：{ev.competitorMatches.join("、")}</Badge> : null}
                    <Link href={`/evidence/${ev.id}`} className="ml-auto inline-flex items-center gap-1 text-primary hover:underline">
                      证据详情 <ArrowUpRight className="h-3 w-3" />
                    </Link>
                    <a
                      href={ev.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      原文 <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 指标口径 */}
      <Dialog open={Boolean(metricDetail)} onOpenChange={(open) => !open && setMetricDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{metricDetail?.label}</DialogTitle>
            <DialogDescription>指标由服务端统一计算，前端不重复计算。</DialogDescription>
          </DialogHeader>
          {metricDetail ? (
            <div className="space-y-3 text-[12px] leading-relaxed">
              <div className="rounded-md bg-surface-muted p-3">
                <p className="font-mono text-[18px] font-semibold">
                  {metricDetail.notConfigured ? "未配置官网" : metricDetail.insufficient ? "样本不足" : formatPercent(metricDetail.value)}
                </p>
                <p className="mt-1 text-tertiary">
                  分子 {metricDetail.numerator} / 分母 {metricDetail.denominator} · 公式版本 {metricDetail.formulaVersion}
                </p>
              </div>
              <div>
                <p className="font-medium text-secondary-soft">统计口径</p>
                <p className="mt-1 text-tertiary">{metricDetail.definition}</p>
              </div>
              <div>
                <p className="font-medium text-secondary-soft">样本范围</p>
                <p className="mt-1 text-tertiary">{metricDetail.sampleScope}</p>
              </div>
              <div>
                <p className="font-medium text-secondary-soft">补充说明</p>
                <p className="mt-1 text-tertiary">{metricDetail.notes}</p>
              </div>
              {metricDetail.smallSample ? (
                <InlineAlert tone="warning">有效样本少于 5 个，指标仅作方向性参考，不应下确定性结论。</InlineAlert>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
