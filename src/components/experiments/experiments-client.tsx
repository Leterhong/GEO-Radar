"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/kpi-card";
import { formatDate, formatPercent } from "@/lib/utils";
import { GitCompareArrows } from "lucide-react";

interface CandidateTask {
  id: string;
  name: string;
  brandName?: string | null;
  finishedAt: string | null;
  status: string;
  brandId: string | null;
}

interface Comparison {
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

function MetricCompare({
  label,
  baseline,
  retest,
}: {
  label: string;
  baseline: { value: number | null; validSamples: number };
  retest: { value: number | null; validSamples: number };
}) {
  const delta =
    baseline.value !== null && retest.value !== null ? retest.value - baseline.value : null;
  return (
    <div className="flex items-center justify-between rounded-md border bg-surface-subtle px-4 py-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-4">
        <span className="font-mono">{formatPercent(baseline.value)}</span>
        <span className="text-muted-foreground">→</span>
        <span className="font-mono font-medium">{formatPercent(retest.value)}</span>
        {delta !== null ? (
          <span className={delta >= 0 ? "text-success" : "text-destructive"}>
            {delta >= 0 ? "+" : ""}
            {(delta * 100).toFixed(1)}pt
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function ExperimentsClient() {
  const [candidates, setCandidates] = useState<CandidateTask[]>([]);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [name, setName] = useState("");
  const [baseline, setBaseline] = useState("");
  const [retest, setRetest] = useState("");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/experiments");
      const json = await res.json();
      if (json.ok) {
        setCandidates(json.data.candidateTasks);
        setHistory(json.data.experiments);
      }
    })();
  }, []);

  async function handleCompare() {
    if (!name.trim()) return toast.error("请填写实验名称");
    if (!baseline || !retest) return toast.error("请选择基线任务与复测任务");
    if (baseline === retest) return toast.error("基线与复测不能是同一个任务");
    setBusy(true);
    try {
      const res = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), baselineTaskId: baseline, retestTaskId: retest }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "对比失败");
        return;
      }
      setComparison(json.data);
      toast.success("对比完成");
      const refresh = await fetch("/api/experiments");
      const refreshJson = await refresh.json();
      if (refreshJson.ok) setHistory(refreshJson.data.experiments);
    } finally {
      setBusy(false);
    }
  }

  if (candidates.length < 2) {
    return (
      <EmptyState
        title="可对比的任务不足"
        description="实验对比需要至少两个已完成的真实搜索任务（基线 + 复测）。请先在搜索实验室完成任务。"
        action={
          <a
            href="/search-lab"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary-strong"
          >
            前往搜索实验室
          </a>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-5">
          <h3 className="text-[15px] font-semibold">创建对比</h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="expName">实验名称</Label>
              <Input id="expName" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：优化官网后第一轮复测" />
            </div>
            <div className="space-y-1.5">
              <Label>基线任务</Label>
              <Select value={baseline} onValueChange={setBaseline}>
                <SelectTrigger>
                  <SelectValue placeholder="选择任务" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}（{t.brandName ?? "—"}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>复测任务</Label>
              <Select value={retest} onValueChange={setRetest}>
                <SelectTrigger>
                  <SelectValue placeholder="选择任务" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}（{t.brandName ?? "—"}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button className="w-full" onClick={handleCompare} disabled={busy}>
                <GitCompareArrows className="mr-1 h-4 w-4" /> {busy ? "对比中…" : "开始对比"}
              </Button>
            </div>
          </div>
          <p className="mt-3 text-[12px] text-tertiary">
            对比要求两个任务使用相同品牌、数据源与执行模式；仅统计两次都成功完成的共同问题。
          </p>
        </CardContent>
      </Card>

      {comparison ? (
        <div className="space-y-4">
          {comparison.sampleWarning ? (
            <div className="rounded-md border border-warning/25 bg-warning-soft p-3 text-xs text-warning">
              {comparison.sampleWarning}
            </div>
          ) : null}
          <Card>
            <CardContent className="p-5">
              <h3 className="text-[15px] font-semibold">指标变化（基线 → 复测）</h3>
              <p className="mt-1 text-[12px] text-tertiary">
                共同成功问题：{comparison.metrics.commonQuestions} 个
              </p>
              <div className="mt-4 space-y-2">
                <MetricCompare label="品牌出现率" baseline={comparison.metrics.baselineBrandAppearance} retest={comparison.metrics.retestBrandAppearance} />
                <MetricCompare label="问题覆盖率" baseline={comparison.metrics.baselineQuestionCoverage} retest={comparison.metrics.retestQuestionCoverage} />
                <MetricCompare label="官网来源覆盖率" baseline={comparison.metrics.baselineOfficialSiteCoverage} retest={comparison.metrics.retestOfficialSiteCoverage} />
              </div>
              <p className="mt-4 rounded-md bg-surface-muted p-3 text-[12px] text-tertiary">{comparison.disclaimer}</p>
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="p-5">
                <h3 className="text-[15px] font-semibold">新增证据 URL（{comparison.newEvidenceUrls.length}）</h3>
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
                  {comparison.newEvidenceUrls.length === 0 ? (
                    <li className="text-muted-foreground">无</li>
                  ) : (
                    comparison.newEvidenceUrls.map((u) => (
                      <li key={u} className="truncate font-mono text-muted-foreground">
                        {u}
                      </li>
                    ))
                  )}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h3 className="text-[15px] font-semibold">消失的证据 URL（{comparison.disappearedEvidenceUrls.length}）</h3>
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
                  {comparison.disappearedEvidenceUrls.length === 0 ? (
                    <li className="text-muted-foreground">无</li>
                  ) : (
                    comparison.disappearedEvidenceUrls.map((u) => (
                      <li key={u} className="truncate font-mono text-muted-foreground">
                        {u}
                      </li>
                    ))
                  )}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {history.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">历史实验</h3>
          <ul className="divide-y rounded-xl border border-border bg-card">
            {history.map((e) => (
              <li key={String(e.id)} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>{String(e.name)}</span>
                <span className="text-[12px] text-tertiary">{formatDate(e.createdAt as string)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
