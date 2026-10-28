"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, SectionTitle } from "@/components/shared/kpi-card";
import { formatDate, formatPercent } from "@/lib/utils";
import { BarChart3, FileText, Loader2, RefreshCw, Trash2, XCircle, Play } from "lucide-react";

interface AnalysisRow {
  id: string;
  name: string;
  brandName: string | null;
  status: string;
  days: number;
  keywordFilter: string | null;
  sampleSize: number;
  answerCount: number;
  scopeNote: string | null;
  errorMessage: string | null;
  metricCount: number;
  reportCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface MetricRow {
  id: string;
  key: string;
  label: string;
  value: number | null;
  numerator: number;
  denominator: number;
  formulaVersion: string;
  insufficient: boolean;
  notes: string | null;
  breakdown: unknown;
}

const STATUS_LABEL: Record<string, string> = {
  QUEUED: "排队中",
  RUNNING: "执行中",
  COMPLETED: "已完成",
  PARTIALLY_COMPLETED: "部分完成",
  FAILED: "失败",
  CANCELLED: "已取消",
};

export function AnalysesClient({
  brands,
  competitorsByBrand,
}: {
  brands: Array<{ id: string; name: string }>;
  competitorsByBrand: Record<string, Array<{ id: string; name: string }>>;
}) {
  const [rows, setRows] = useState<AnalysisRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [detail, setDetail] = useState<AnalysisRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [days, setDays] = useState("30");
  const [keyword, setKeyword] = useState("");
  const [selectedCompetitors, setSelectedCompetitors] = useState<string[]>([]);

  const loadList = useCallback(async () => {
    const res = await fetch("/api/analyses");
    const json = await res.json();
    if (json.ok) setRows(json.data.tasks);
    setLoading(false);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/analyses/${id}`);
    const json = await res.json();
    if (!json.ok) return;
    setMetrics(json.data.metrics);
    setDetail({
      id: json.data.task.id,
      name: json.data.task.name,
      brandName: json.data.task.brand?.name ?? null,
      status: json.data.task.status,
      days: json.data.task.days,
      keywordFilter: json.data.task.keywordFilter,
      sampleSize: json.data.task.sampleSize,
      answerCount: json.data.task.answerCount,
      scopeNote: json.data.task.scopeNote,
      errorMessage: json.data.task.errorMessage,
      metricCount: json.data.metrics.length,
      reportCount: json.data.reports.length,
      startedAt: json.data.task.startedAt,
      finishedAt: json.data.task.finishedAt,
      createdAt: json.data.task.createdAt,
    });
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selected) return;
    void loadDetail(selected);
    const active = rows.find((r) => r.id === selected);
    if (!active || !["QUEUED", "RUNNING"].includes(active.status)) return;
    const timer = setInterval(async () => {
      await loadList();
      await loadDetail(selected);
    }, 2500);
    return () => clearInterval(timer);
  }, [selected, rows, loadList, loadDetail]);

  const brandCompetitors = brandId ? competitorsByBrand[brandId] ?? [] : [];

  async function handleCreate() {
    if (!brandId) return toast.error("请先创建并选择品牌");
    if (name.trim() === "") return toast.error("请填写分析任务名称");
    setBusy(true);
    try {
      const res = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          brandId,
          days: Number(days),
          keywordFilter: keyword.trim(),
          competitorIds: selectedCompetitors,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "创建失败");
        return;
      }
      toast.success("分析任务已创建（仅使用已保存数据，不发起外部搜索）");
      setCreateOpen(false);
      setName("");
      setKeyword("");
      setSelectedCompetitors([]);
      await loadList();
      setSelected(json.data.id);
    } finally {
      setBusy(false);
    }
  }

  async function handleAction(id: string, action: "retry" | "cancel") {
    setBusy(true);
    try {
      const res = await fetch(`/api/analyses/${id}/action?action=${action}`, { method: "POST" });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "操作失败");
        return;
      }
      toast.success(action === "retry" ? "已重新执行" : "已取消");
      await loadList();
      if (selected === id) await loadDetail(id);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/analyses/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "删除失败");
        return;
      }
      toast.success("分析任务已删除（已生成的报告保留）");
      if (selected === id) {
        setSelected(null);
        setDetail(null);
        setMetrics([]);
      }
      await loadList();
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateReport(analysisId: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisTaskId: analysisId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "生成失败");
        return;
      }
      toast.success("报告已生成，可在「分析报告」查看");
      await loadList();
      await loadDetail(analysisId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-tertiary">
          <Badge variant="info">只读分析</Badge>
          分析只使用已保存的搜索问答与实验室任务，不会自动发起任何外部搜索或模型调用。
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={brands.length === 0}>
          <BarChart3 className="mr-1.5 h-4 w-4" /> 新建分析任务
        </Button>
      </div>

      {brands.length === 0 ? (
        <EmptyState
          title="尚未创建品牌"
          description="GEO 分析以品牌为单位。请先在「品牌管理」创建品牌并补齐官网域名与别名。"
          action={
            <a href="/brands" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground">
              前往品牌管理
            </a>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
          {/* 任务列表 */}
          <div className="space-y-2">
            <SectionTitle title="分析任务" description={`共 ${rows.length} 个`} />
            {loading ? (
              <p className="rounded-lg border border-border bg-card px-4 py-8 text-center text-[12px] text-tertiary">加载中…</p>
            ) : rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-[12px] leading-relaxed text-tertiary">
                还没有分析任务。
                <br />
                建议先在「对话工作台」用「搜索问答」模式积累带来源的回答。
              </p>
            ) : (
              rows.map((row) => (
                <button
                  key={row.id}
                  onClick={() => setSelected(row.id)}
                  className={`w-full rounded-xl border px-3.5 py-3 text-left transition-colors ${
                    selected === row.id ? "border-border-strong bg-primary-soft" : "border-border bg-card hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-[color:var(--text-primary)]">{row.name}</p>
                    <Badge
                      variant={
                        row.status === "COMPLETED"
                          ? "success"
                          : row.status === "FAILED"
                            ? "destructive"
                            : row.status === "PARTIALLY_COMPLETED"
                              ? "warning"
                              : row.status === "RUNNING"
                                ? "info"
                                : "muted"
                      }
                    >
                      {STATUS_LABEL[row.status] ?? row.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-quaternary">
                    {row.brandName ?? "—"} · 近 {row.days} 天 · 有效回答 {row.answerCount}
                  </p>
                  <p className="mt-0.5 text-[10px] text-quaternary">{formatDate(row.createdAt)}</p>
                </button>
              ))
            )}
          </div>

          {/* 详情 */}
          <div className="min-w-0">
            {!detail ? (
              <Card>
                <CardContent className="flex min-h-[320px] flex-col items-center justify-center text-center">
                  <BarChart3 className="h-8 w-8 text-quaternary" />
                  <p className="mt-3 text-[14px] font-medium text-[color:var(--text-primary)]">选择一个分析任务查看指标</p>
                  <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-tertiary">
                    所有指标由确定性代码计算并落库（含分子、分母与公式版本），模型不参与数值产生。
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <Card>
                  <CardContent className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-[16px] font-semibold text-[color:var(--text-primary)]">{detail.name}</h3>
                        <p className="mt-1 text-[12px] text-tertiary">
                          {detail.brandName ?? "—"} · 近 {detail.days} 天
                          {detail.keywordFilter ? ` · 关键词「${detail.keywordFilter}」` : ""}
                        </p>
                        {detail.scopeNote ? <p className="mt-1 text-[11px] text-quaternary">{detail.scopeNote}</p> : null}
                        {detail.errorMessage ? <p className="mt-1 text-[11px] text-destructive">{detail.errorMessage}</p> : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {["QUEUED", "RUNNING"].includes(detail.status) ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            <Button size="sm" variant="outline" onClick={() => void handleAction(detail.id, "cancel")} disabled={busy}>
                              <XCircle className="mr-1 h-3.5 w-3.5" /> 取消
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" onClick={() => void handleAction(detail.id, "retry")} disabled={busy}>
                              <RefreshCw className="mr-1 h-3.5 w-3.5" /> 重新计算
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => void handleDelete(detail.id)} disabled={busy}>
                              <Trash2 className="mr-1 h-3.5 w-3.5" /> 删除
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => void handleCreateReport(detail.id)}
                              disabled={busy || detail.metricCount === 0 || ["QUEUED", "RUNNING"].includes(detail.status)}
                            >
                              <FileText className="mr-1 h-3.5 w-3.5" /> 生成报告
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    {detail.status === "PARTIALLY_COMPLETED" ? (
                      <p className="mt-3 rounded-lg border border-warning/25 bg-warning-soft px-3 py-2 text-[11px] text-warning">
                        有效样本为 0：指标不可计算。请先在对话工作台用「搜索问答」模式获得带来源的回答。
                      </p>
                    ) : null}
                  </CardContent>
                </Card>

                {metrics.length === 0 ? (
                  <EmptyState title="暂无指标" description="任务尚未完成或没有可用样本。" />
                ) : (
                  <div className="space-y-3">
                    <SectionTitle title="指标结果" description="数值、分子、分母与公式版本均已落库，可随时复核。" />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {metrics
                        .filter((m) => !["keyword_breakdown", "daily_trend", "lab_question_set_breakdown"].includes(m.key))
                        .map((metric) => (
                          <Card key={metric.id}>
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-[12px] font-medium text-tertiary">{metric.label}</p>
                                <Badge variant="muted" className="font-mono text-[9px]">
                                  {metric.formulaVersion}
                                </Badge>
                              </div>
                              <p className="mt-1.5 text-[22px] font-semibold leading-none tracking-tight">
                                {metric.key === "valid_answers" || metric.key === "brand_mention_count"
                                  ? metric.numerator
                                  : metric.insufficient
                                    ? "不可计算"
                                    : formatPercent(metric.value)}
                              </p>
                              <p className="mt-1.5 text-[11px] text-quaternary">
                                分子 {metric.numerator} / 分母 {metric.denominator}
                                {metric.insufficient ? " · 样本不足" : ""}
                              </p>
                              {metric.notes ? (
                                <p className="mt-2 border-t border-border pt-2 text-[11px] leading-relaxed text-tertiary">{metric.notes}</p>
                              ) : null}
                            </CardContent>
                          </Card>
                        ))}
                    </div>

                    {metrics
                      .filter((m) => ["keyword_breakdown", "lab_question_set_breakdown", "daily_trend"].includes(m.key))
                      .map((metric) => {
                        const rows = Array.isArray(metric.breakdown) ? (metric.breakdown as Array<Record<string, unknown>>) : [];
                        if (rows.length === 0) return null;
                        return (
                          <Card key={metric.id}>
                            <CardContent className="p-4">
                              <SectionTitle title={metric.label} description={metric.notes ?? undefined} />
                              <div className="overflow-x-auto">
                                <table className="w-full text-[12px]">
                                  <thead>
                                    <tr className="border-b border-border text-left text-[11px] text-tertiary">
                                      {Object.keys(rows[0] ?? {}).map((column) => (
                                        <th key={column} className="py-1.5 pr-4 font-medium">
                                          {column}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rows.map((row, index) => (
                                      <tr key={index} className="border-b border-border/60 last:border-0">
                                        {Object.keys(rows[0] ?? {}).map((column) => (
                                          <td key={column} className="py-1.5 pr-4 text-secondary-soft">
                                            {row[column] === null || row[column] === undefined
                                              ? "—"
                                              : typeof row[column] === "number"
                                                ? String(row[column])
                                                : String(row[column])}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>新建 GEO 分析任务</DialogTitle>
            <DialogDescription>
              只读取已保存的搜索问答回答与实验室任务。不会新增外部搜索，也不会调用模型。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="anName">任务名称</Label>
              <Input id="anName" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：10 月品牌可见度复盘" maxLength={100} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>品牌</Label>
                <Select
                  value={brandId}
                  onValueChange={(v) => {
                    setBrandId(v);
                    setSelectedCompetitors([]);
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
              <div className="space-y-1.5">
                <Label>时间范围</Label>
                <Select value={days} onValueChange={setDays}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">近 7 天</SelectItem>
                    <SelectItem value="30">近 30 天</SelectItem>
                    <SelectItem value="90">近 90 天</SelectItem>
                    <SelectItem value="365">近一年</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="anKeyword">关键词过滤（可选）</Label>
              <Input id="anKeyword" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="只统计问题中包含该关键词的回答" />
            </div>
            <div className="space-y-1.5">
              <Label>对比竞品（可选）</Label>
              {brandCompetitors.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-tertiary">
                  该品牌尚未添加竞品，可在「竞品分析」添加后重新分析。
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {brandCompetitors.map((c) => {
                    const active = selectedCompetitors.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          setSelectedCompetitors((prev) =>
                            prev.includes(c.id) ? prev.filter((id) => id !== c.id) : [...prev, c.id]
                          )
                        }
                        className={`rounded-md border px-2.5 py-1 text-[12px] transition-colors ${
                          active ? "border-border-strong bg-primary-soft text-primary-strong" : "border-border bg-card text-secondary-soft hover:border-border-strong"
                        }`}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={busy}>
              <Play className="mr-1 h-4 w-4" /> 开始分析
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
