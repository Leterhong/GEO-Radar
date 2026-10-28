"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionTitle } from "@/components/shared/kpi-card";
import { formatDate } from "@/lib/utils";
import { Download, FileText, Trash2, Pencil, GitCompareArrows, Database } from "lucide-react";

interface ReportRow {
  id: string;
  title: string;
  kind: string;
  brandName: string | null;
  searchTaskId: string | null;
  version: number;
  generatedAt: string;
  windowFrom: string | null;
  windowTo: string | null;
}

interface Candidate {
  id: string;
  name: string;
  brandName: string | null;
  metricCount: number;
  status: string;
}

interface TaskCandidate {
  id: string;
  name: string;
  brandName: string | null;
  questionSetName: string | null;
  questionSetVersion: number | null;
  baselineTaskId: string | null;
  totalItems: number;
  successItems: number;
  failedItems: number;
  emptyItems: number;
  evidenceCount: number;
  finishedAt: string | null;
}

const KIND_LABELS: Record<string, string> = {
  ANALYSIS: "分析报告",
  SEARCH_EVIDENCE: "搜索证据报告",
  COMPARISON: "两轮对比报告",
};

export function ReportsClient({
  reports,
  candidates,
  tasks,
  initialTaskId,
}: {
  reports: ReportRow[];
  candidates: Candidate[];
  tasks: TaskCandidate[];
  initialTaskId?: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(reports);
  const [taskId, setTaskId] = useState(
    initialTaskId && tasks.some((t) => t.id === initialTaskId) ? initialTaskId : tasks[0]?.id ?? ""
  );
  const [compareId, setCompareId] = useState("none");
  const [taskTitle, setTaskTitle] = useState("");
  const [analysisId, setAnalysisId] = useState(candidates[0]?.id ?? "");
  const [analysisTitle, setAnalysisTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const selectedTask = useMemo(() => tasks.find((t) => t.id === taskId), [tasks, taskId]);

  useEffect(() => {
    if (!selectedTask) return;
    if (selectedTask.baselineTaskId && tasks.some((t) => t.id === selectedTask.baselineTaskId)) {
      setCompareId(selectedTask.baselineTaskId);
    } else {
      setCompareId("none");
    }
  }, [selectedTask, tasks]);

  const compareOptions = useMemo(() => tasks.filter((t) => t.id !== taskId), [tasks, taskId]);

  async function handleCreateFromTask() {
    if (!taskId) return toast.error("请选择采集任务");
    setBusy(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          compareTaskId: compareId === "none" ? undefined : compareId,
          title: taskTitle.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "生成失败");
        return;
      }
      toast.success("报告已生成");
      router.push(`/reports/${json.data.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateFromAnalysis() {
    if (!analysisId) return toast.error("请选择分析任务");
    setBusy(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisTaskId: analysisId, title: analysisTitle.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "生成失败");
        return;
      }
      toast.success("报告已生成");
      router.push(`/reports/${json.data.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/reports/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "删除失败");
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== id));
      toast.success("报告已删除");
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(id: string) {
    if (renameValue.trim() === "") return;
    const res = await fetch(`/api/reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: renameValue.trim() }),
    });
    const json = await res.json();
    if (!json.ok) {
      toast.error(json?.error?.message ?? "重命名失败");
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, title: renameValue.trim() } : r)));
    setRenameId(null);
    toast.success("已重命名");
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <SectionTitle
              title="从采集任务生成（推荐）"
              description="基于真实搜索证据生成：矩阵、指标口径、代表证据、历史变化与规则建议。"
            />
            <div className="space-y-2.5">
              <div className="space-y-1.5">
                <label className="text-[12px] text-secondary-soft">采集任务</label>
                <Select value={taskId} onValueChange={setTaskId}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择已完成任务" />
                  </SelectTrigger>
                  <SelectContent>
                    {tasks.map((task) => (
                      <SelectItem key={task.id} value={task.id}>
                        {task.name}（{task.brandName ?? "—"} · {task.questionSetName ?? "—"} · {task.finishedAt ? formatDate(task.finishedAt) : "—"}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedTask ? (
                <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-[11px] text-tertiary">
                  问题 {selectedTask.totalItems} · 成功 {selectedTask.successItems} · 失败 {selectedTask.failedItems} · 空结果 {selectedTask.emptyItems} · 证据{" "}
                  {selectedTask.evidenceCount} · 问题集 v{selectedTask.questionSetVersion ?? "未知"}
                </div>
              ) : null}
              <div className="space-y-1.5">
                <label className="text-[12px] text-secondary-soft">对比上一轮（可选）</label>
                <Select value={compareId} onValueChange={setCompareId}>
                  <SelectTrigger>
                    <SelectValue placeholder="不对比" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不关联历史轮次</SelectItem>
                    {compareOptions.map((task) => (
                      <SelectItem key={task.id} value={task.id}>
                        {task.name}（{task.finishedAt ? formatDate(task.finishedAt) : "—"}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[12px] text-secondary-soft">报告标题（可选）</label>
                <Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="留空则自动命名" maxLength={150} />
              </div>
              <Button onClick={handleCreateFromTask} disabled={busy || !taskId}>
                <Database className="mr-1.5 h-4 w-4" /> 生成证据报告
                {compareId !== "none" ? <GitCompareArrows className="ml-1 h-3.5 w-3.5" /> : null}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <SectionTitle
              title="从 GEO 分析任务生成"
              description="基于对话工作台「搜索问答」的 answer 级分析指标，不重新计算、不调用外部服务。"
            />
            {candidates.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[12px] text-tertiary">
                还没有已完成的分析任务。可在「GEO 分析」创建。
              </p>
            ) : (
              <div className="space-y-2.5">
                <div className="space-y-1.5">
                  <label className="text-[12px] text-secondary-soft">分析任务</label>
                  <Select value={analysisId} onValueChange={setAnalysisId}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择分析任务" />
                    </SelectTrigger>
                    <SelectContent>
                      {candidates.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}（{c.brandName ?? "—"} · {c.metricCount} 项指标）
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12px] text-secondary-soft">报告标题（可选）</label>
                  <Input value={analysisTitle} onChange={(e) => setAnalysisTitle(e.target.value)} placeholder="留空则自动命名" maxLength={150} />
                </div>
                <Button onClick={handleCreateFromAnalysis} disabled={busy || !analysisId} variant="outline">
                  <FileText className="mr-1.5 h-4 w-4" /> 生成分析报告
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <SectionTitle title="历史报告" description={`共 ${rows.length} 份，快照不可被后续数据变化改写`} />
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card px-4 py-10 text-center text-[12px] text-tertiary">
            暂无报告
          </p>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {rows.map((report) => (
              <div key={report.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  {renameId === report.id ? (
                    <div className="flex items-center gap-2">
                      <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="h-8 max-w-xs" maxLength={150} />
                      <Button size="sm" onClick={() => void handleRename(report.id)}>
                        保存
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRenameId(null)}>
                        取消
                      </Button>
                    </div>
                  ) : (
                    <a href={`/reports/${report.id}`} className="truncate text-[13px] font-medium text-[color:var(--text-primary)] hover:text-primary">
                      {report.title}
                    </a>
                  )}
                  <p className="mt-0.5 text-[11px] text-quaternary">
                    {report.brandName ?? "—"} · v{report.version} ·{" "}
                    {report.windowFrom && report.windowTo ? `${report.windowFrom.slice(0, 10)} ~ ${report.windowTo.slice(0, 10)}` : "—"} · 生成于{" "}
                    {formatDate(report.generatedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant={report.kind === "COMPARISON" ? "info" : report.kind === "SEARCH_EVIDENCE" ? "success" : "muted"} className="text-[10px]">
                    {KIND_LABELS[report.kind] ?? report.kind}
                  </Badge>
                  {report.searchTaskId ? (
                    <Button variant="ghost" size="sm" asChild>
                      <a href={`/search-lab/${report.searchTaskId}`}>任务</a>
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="icon" aria-label="重命名" onClick={() => { setRenameId(report.id); setRenameValue(report.title); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" asChild aria-label="导出 Markdown">
                    <a href={`/api/reports/${report.id}/export?format=md`}>
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="删除报告" onClick={() => void handleDelete(report.id)} disabled={busy}>
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
