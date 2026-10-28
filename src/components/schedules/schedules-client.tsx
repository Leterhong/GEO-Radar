"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, InlineAlert, SectionTitle } from "@/components/shared/kpi-card";
import { formatDate } from "@/lib/utils";
import { AlertTriangle, Ban, Clock, ExternalLink, Pause, Play, Plus, RefreshCw, Trash2 } from "lucide-react";

interface Brand {
  id: string;
  name: string;
}

interface QuestionSetOption {
  id: string;
  name: string;
  currentVersion: number;
  enabledCount: number;
}

interface RunRow {
  id: string;
  plannedAt: string;
  status: string;
  error: string | null;
  task: { id: string; name: string; status: string } | null;
  createdAt: string;
}

interface ScheduleRow {
  id: string;
  name: string;
  status: string;
  frequency: "DAILY" | "WEEKLY";
  timezone: string;
  hour: number;
  minute: number;
  weekday: number | null;
  executionMode: "REAL" | "MOCK";
  confirmedCost: boolean;
  brandName: string | null;
  questionSetName: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  failureCount: number;
  timingDescription: string;
  runs: RunRow[];
}

interface ListResponse {
  schedules: ScheduleRow[];
  providerReady: boolean;
  providerReason: string | null;
  runningTasks: number;
  maxConcurrent: number;
  maxQuestions: number;
  config: {
    maxConcurrent: number;
    maxQuestions: number;
    maxActivePerWorkspace: number;
    cronConfigured: boolean;
    tickIntervalMs: number;
  };
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "启用中",
  PAUSED: "已暂停",
  CANCELLED: "已取消",
  COMPLETED: "已完成",
  FAILED: "失败",
  SKIPPED: "已跳过",
  PENDING: "待执行",
  RUNNING: "执行中",
};

function scheduleStatusVariant(status: string): "success" | "warning" | "muted" | "destructive" | "secondary" {
  if (status === "ACTIVE" || status === "COMPLETED") return "success";
  if (status === "PAUSED" || status === "SKIPPED" || status === "RUNNING") return "warning";
  if (status === "FAILED") return "destructive";
  return "muted";
}

export function SchedulesClient({
  brands,
  questionSets,
  providerReady,
  providerReason,
}: {
  brands: Brand[];
  questionSets: QuestionSetOption[];
  providerReady: boolean;
  providerReason: string | null;
}) {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runTarget, setRunTarget] = useState<ScheduleRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ScheduleRow | null>(null);

  const [name, setName] = useState("");
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "none");
  const [questionSetId, setQuestionSetId] = useState(questionSets[0]?.id ?? "");
  const [frequency, setFrequency] = useState<"DAILY" | "WEEKLY">("DAILY");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [hour, setHour] = useState("9");
  const [minute, setMinute] = useState("0");
  const [weekday, setWeekday] = useState("1");
  const [executionMode, setExecutionMode] = useState<"REAL" | "MOCK">(providerReady ? "REAL" : "MOCK");
  const [maxResults, setMaxResults] = useState("10");
  const [confirmedCost, setConfirmedCost] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/schedules");
      const json = await res.json();
      if (res.ok && json.ok) setData(json.data);
      else toast.error(json?.error?.message ?? "排期加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedSet = useMemo(() => questionSets.find((s) => s.id === questionSetId), [questionSets, questionSetId]);
  const estimatedRequests = selectedSet?.enabledCount ?? 0;

  function resetForm() {
    setName("");
    setBrandId(brands[0]?.id ?? "none");
    setQuestionSetId(questionSets[0]?.id ?? "");
    setFrequency("DAILY");
    setTimezone("Asia/Shanghai");
    setHour("9");
    setMinute("0");
    setWeekday("1");
    setExecutionMode(providerReady ? "REAL" : "MOCK");
    setMaxResults("10");
    setConfirmedCost(false);
  }

  async function createSchedule() {
    if (!name.trim()) return toast.error("请填写排期名称");
    if (!questionSetId) return toast.error("请选择问题集");
    if (executionMode === "REAL" && !confirmedCost) return toast.error("真实定时采集需要明确确认调用成本");
    setBusy(true);
    try {
      const res = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          brandId: brandId === "none" ? undefined : brandId,
          questionSetId,
          frequency,
          timezone: timezone.trim(),
          hour: Number(hour),
          minute: Number(minute),
          weekday: frequency === "WEEKLY" ? Number(weekday) : undefined,
          executionMode,
          confirmedCost,
          params: { maxResults: Number(maxResults) || undefined },
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "创建失败");
        return;
      }
      toast.success(`排期已创建，下次执行：${formatDate(json.data.nextRunAt)}`);
      setOpen(false);
      resetForm();
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(schedule: ScheduleRow, status: "ACTIVE" | "PAUSED") {
    setBusy(true);
    try {
      const res = await fetch(`/api/schedules/${schedule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "操作失败");
        return;
      }
      toast.success(status === "PAUSED" ? "排期已暂停" : "排期已恢复");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    if (!runTarget) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/schedules/${runTarget.id}/run`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "执行失败");
        return;
      }
      toast.success("已创建并开始执行任务");
      setRunTarget(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function cancelSchedule() {
    if (!cancelTarget) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/schedules/${cancelTarget.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "取消失败");
        return;
      }
      toast.success("排期已取消（执行历史保留）");
      setCancelTarget(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const schedules = data?.schedules ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-[12px] text-tertiary">数据源状态</p>
            <div className="mt-1.5">
              {providerReady ? (
                <Badge variant="success">真实搜索已就绪</Badge>
              ) : (
                <Badge variant="destructive">真实搜索未就绪</Badge>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-quaternary">{providerReason ?? "已通过连接测试，可执行真实定时采集。"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[12px] text-tertiary">并发与限额</p>
            <p className="mt-1.5 text-[13px] font-medium">
              运行中 {data?.runningTasks ?? 0} / 上限 {data?.maxConcurrent ?? 1}
            </p>
            <p className="mt-1 text-[11px] text-quaternary">
              单排期最多 {data?.maxQuestions ?? 50} 个问题；每空间最多 {data?.config.maxActivePerWorkspace ?? 10} 个启用排期。
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[12px] text-tertiary">调度方式</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge variant="muted">外部调度（cron / scheduler 进程）</Badge>
              <Badge variant={data?.config.cronConfigured ? "success" : "warning"}>
                CRON_SECRET：{data?.config.cronConfigured ? "已配置" : "未配置"}
              </Badge>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-quaternary">
              定时执行由外部 cron 或独立 <code className="font-mono">npm run scheduler</code> 进程调用 POST /api/schedules/tick 触发，
              不依赖浏览器页面；未配置 CRON_SECRET 时只能由登录用户手动触发。
            </p>
          </CardContent>
        </Card>
      </div>

      {!providerReady && executionMode === "REAL" ? (
        <InlineAlert tone="warning" title="真实模式不可用">
          请先在设置页完成元宝搜索 API Key 配置与连接测试，否则真实排期会在执行时标记失败，而不会伪造结果。
        </InlineAlert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle title="定时采集排期" description="排期由外部调度器驱动，不依赖浏览器；每次执行都创建新任务，不复用历史结果。" className="mb-0" />
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> 刷新
          </Button>
          <Button
            onClick={() => {
              resetForm();
              setOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> 新建排期
          </Button>
        </div>
      </div>

      {schedules.length === 0 && !loading ? (
        <EmptyState
          title="还没有定时排期"
          description="手动复测稳定后，再启用定时采集。创建排期时需要明确确认调用成本，并可随时暂停。"
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> 创建第一个排期
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {schedules.map((schedule) => (
            <Card key={schedule.id}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold">{schedule.name}</span>
                      <Badge variant={scheduleStatusVariant(schedule.status)}>{STATUS_LABELS[schedule.status] ?? schedule.status}</Badge>
                      <Badge variant={schedule.executionMode === "REAL" ? "secondary" : "warning"}>
                        {schedule.executionMode === "REAL" ? "真实" : "模拟"}
                      </Badge>
                      {schedule.executionMode === "REAL" && !schedule.confirmedCost ? <Badge variant="warning">未确认成本</Badge> : null}
                    </div>
                    <p className="mt-1 text-[11px] text-tertiary">
                      {schedule.timingDescription} · {schedule.brandName ?? "未关联品牌"} · {schedule.questionSetName}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-3 text-[11px]">
                      <span className="text-quaternary">下次执行：{schedule.nextRunAt ? formatDate(schedule.nextRunAt) : "—"}</span>
                      <span className="text-quaternary">上次执行：{schedule.lastRunAt ? formatDate(schedule.lastRunAt) : "—"}</span>
                      <span className={schedule.lastRunStatus === "FAILED" ? "text-destructive" : "text-quaternary"}>
                        上次结果：{schedule.lastRunStatus ? STATUS_LABELS[schedule.lastRunStatus] ?? schedule.lastRunStatus : "—"}
                      </span>
                      {schedule.failureCount > 0 ? <span className="text-warning">连续失败 {schedule.failureCount}</span> : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {schedule.status === "ACTIVE" ? (
                      <Button size="sm" variant="outline" onClick={() => void updateStatus(schedule, "PAUSED")} disabled={busy}>
                        <Pause className="mr-1 h-3.5 w-3.5" /> 暂停
                      </Button>
                    ) : schedule.status === "PAUSED" ? (
                      <Button size="sm" variant="outline" onClick={() => void updateStatus(schedule, "ACTIVE")} disabled={busy}>
                        <Play className="mr-1 h-3.5 w-3.5" /> 恢复
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" onClick={() => setRunTarget(schedule)} disabled={schedule.status === "CANCELLED"}>
                      <Clock className="mr-1 h-3.5 w-3.5" /> 立即执行
                    </Button>
                    {schedule.status !== "CANCELLED" ? (
                      <Button size="sm" variant="ghost" onClick={() => setCancelTarget(schedule)} disabled={busy}>
                        <Ban className="mr-1 h-3.5 w-3.5" /> 取消
                      </Button>
                    ) : null}
                  </div>
                </div>

                {schedule.runs.length > 0 ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[11px] text-tertiary">最近执行记录（{schedule.runs.length}）</summary>
                    <div className="mt-2 overflow-x-auto rounded-md border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-40">计划时间</TableHead>
                            <TableHead className="w-24">状态</TableHead>
                            <TableHead>任务 / 错误</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {schedule.runs.map((run) => (
                            <TableRow key={run.id}>
                              <TableCell className="text-[11px] text-tertiary">{formatDate(run.plannedAt)}</TableCell>
                              <TableCell>
                                <Badge variant={scheduleStatusVariant(run.status)}>{STATUS_LABELS[run.status] ?? run.status}</Badge>
                              </TableCell>
                              <TableCell className="text-[11px]">
                                {run.task ? (
                                  <Link href={`/search-lab/${run.task.id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                                    {run.task.name}
                                    <ExternalLink className="h-3 w-3" />
                                  </Link>
                                ) : null}
                                {run.error ? <p className={run.task ? "mt-0.5 text-destructive" : "text-destructive"}>{run.error}</p> : null}
                                {!run.task && !run.error ? "—" : null}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </details>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 新建排期 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>新建定时采集排期</DialogTitle>
            <DialogDescription>创建排期本身不会立即调用搜索；真实模式会在每次到点时创建并执行新任务。</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="sName">排期名称</Label>
              <Input id="sName" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：核心问题每日监测" />
            </div>
            <div className="space-y-1.5">
              <Label>品牌（可选）</Label>
              <Select value={brandId} onValueChange={setBrandId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不关联品牌</SelectItem>
                  {brands.map((brand) => <SelectItem key={brand.id} value={brand.id}>{brand.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>问题集</Label>
              <Select value={questionSetId} onValueChange={setQuestionSetId}>
                <SelectTrigger><SelectValue placeholder="选择问题集" /></SelectTrigger>
                <SelectContent>
                  {questionSets.map((set) => (
                    <SelectItem key={set.id} value={set.id}>{set.name}（{set.enabledCount} 个启用问题）</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>频率</Label>
              <Select value={frequency} onValueChange={(value) => setFrequency(value as "DAILY" | "WEEKLY")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAILY">每天</SelectItem>
                  <SelectItem value="WEEKLY">每周</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>执行模式</Label>
              <Select value={executionMode} onValueChange={(value) => setExecutionMode(value as "REAL" | "MOCK")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="REAL">真实搜索（元宝）</SelectItem>
                  <SelectItem value="MOCK">模拟模式（验证流程）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tz">时区（IANA）</Label>
              <Input id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Shanghai" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="hour">小时</Label>
                <Input id="hour" type="number" min={0} max={23} value={hour} onChange={(e) => setHour(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="minute">分钟</Label>
                <Input id="minute" type="number" min={0} max={59} value={minute} onChange={(e) => setMinute(e.target.value)} />
              </div>
            </div>
            {frequency === "WEEKLY" ? (
              <div className="space-y-1.5">
                <Label>星期</Label>
                <Select value={weekday} onValueChange={setWeekday}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((label, index) => (
                      <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label>每问题返回条数（Cnt）</Label>
              <Select value={maxResults} onValueChange={setMaxResults}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["10", "20", "30", "40", "50"].map((value) => <SelectItem key={value} value={value}>{value} 条</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-[11px] text-tertiary">
              预计每轮请求：<span className="font-medium text-[color:var(--text-primary)]">{estimatedRequests}</span> 个问题（等于请求数，失败重试会产生少量额外请求）
              {selectedSet ? ` · 使用创建时问题集版本 v${selectedSet.currentVersion}` : ""}
              <span className="mt-1 block text-quaternary">后续编辑问题集会生成新版本，但不会改变已创建排期使用的版本；如需使用新版本，请新建排期。</span>
            </div>
            {executionMode === "REAL" ? (
              <label className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[11px] text-warning sm:col-span-2">
                <input type="checkbox" checked={confirmedCost} onChange={(e) => setConfirmedCost(e.target.checked)} className="mt-0.5" />
                <span>
                  我确认开启真实定时采集会产生持续的 API 调用成本（每轮 {estimatedRequests} 次搜索请求）。可随时暂停排期，但已发生的调用不会退款。
                </span>
              </label>
            ) : null}
            {executionMode === "REAL" && !providerReady ? (
              <p className="sm:col-span-2 text-[11px] text-destructive">真实数据源未就绪：请先完成配置与连接测试。</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={() => void createSchedule()} disabled={busy || (executionMode === "REAL" && (!confirmedCost || !providerReady))}>
              创建排期
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 立即执行确认 */}
      <Dialog open={Boolean(runTarget)} onOpenChange={(open) => !open && setRunTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>立即执行排期</DialogTitle>
            <DialogDescription>会创建一轮新的真实任务并开始执行，不会复用历史结果。</DialogDescription>
          </DialogHeader>
          {runTarget ? (
            <div className="space-y-2 rounded-md border bg-surface-muted p-3 text-[12px]">
              <p>排期：{runTarget.name}</p>
              <p>模式：{runTarget.executionMode === "REAL" ? "真实搜索（会产生调用）" : "模拟模式（不产生真实调用）"}</p>
              <p>问题集：{runTarget.questionSetName}</p>
              <p className="text-tertiary">执行时间：{formatDate(new Date().toISOString())}</p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunTarget(null)}>取消</Button>
            <Button onClick={() => void runNow()} disabled={busy}>确认执行</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 取消确认 */}
      <Dialog open={Boolean(cancelTarget)} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>取消排期</DialogTitle>
            <DialogDescription>取消后不再自动执行；已产生的任务与执行记录会保留，可追溯。</DialogDescription>
          </DialogHeader>
          {cancelTarget ? <p className="text-[13px]">{cancelTarget.name}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>保留排期</Button>
            <Button variant="destructive" onClick={() => void cancelSchedule()} disabled={busy}>
              <Trash2 className="mr-1 h-4 w-4" /> 确认取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="rounded-xl border border-border bg-surface-subtle/60 p-4 text-[11px] leading-relaxed text-tertiary">
        <p className="flex items-center gap-1.5 font-medium text-secondary-soft">
          <AlertTriangle className="h-3.5 w-3.5 text-warning" /> 调度可靠性说明
        </p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>定时执行由外部 cron 或独立 scheduler 进程触发（POST /api/schedules/tick），不依赖浏览器页面保持打开。</li>
          <li>同一排期同一计划时间只会创建一次任务（数据库唯一约束），重复 tick 会被安全跳过。</li>
          <li>任务执行仍在 Web 进程内，进程重启会中断正在执行的任务，需在部署层保证稳定性。</li>
          <li>失败排期保留失败状态与错误分类，不会用模拟数据填补缺失结果。</li>
        </ul>
      </div>
    </div>
  );
}
