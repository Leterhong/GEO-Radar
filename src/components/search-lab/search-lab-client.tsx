"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TaskStatusBadge } from "@/components/shared/status-badges";
import { EmptyState } from "@/components/shared/kpi-card";
import { CredentialStatusBadge } from "@/components/shared/status-badges";
import { formatDate, formatDuration } from "@/lib/utils";
import { Plus, Play, AlertTriangle } from "lucide-react";

interface Brand { id: string; name: string }
interface QuestionSet { id: string; name: string; questionCount: number }
interface TaskRow {
  id: string;
  name: string;
  brandName: string | null;
  executionMode: "REAL" | "MOCK";
  provider: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "PARTIAL_FAILED" | "FAILED" | "CANCELLED";
  totalItems: number;
  successItems: number;
  failedItems: number;
  createdAt: string;
  finishedAt: string | null;
  creatorName: string;
}

export function SearchLabClient({
  brands,
  questionSets,
  credentialStatus,
  hasCredential,
  globallyEnabled,
  initialTasks,
}: {
  brands: Brand[];
  questionSets: QuestionSet[];
  credentialStatus: "NOT_CONFIGURED" | "PENDING_VERIFICATION" | "CONNECTED" | "FAILED" | "DISABLED";
  hasCredential: boolean;
  globallyEnabled: boolean;
  initialTasks: TaskRow[];
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // 表单状态
  const [name, setName] = useState("");
  const [brandId, setBrandId] = useState<string>(brands[0]?.id ?? "none");
  const [questionSetId, setQuestionSetId] = useState<string>(questionSets[0]?.id ?? "");
  const [executionMode, setExecutionMode] = useState<"REAL" | "MOCK">("REAL");
  const [maxResults, setMaxResults] = useState<string>("10");
  const [freshness, setFreshness] = useState<string>("none");
  const [industry, setIndustry] = useState<string>("none");
  const [pendingTask, setPendingTask] = useState<TaskRow | null>(null);

  const realReady = globallyEnabled && credentialStatus === "CONNECTED";
  const selectedSet = useMemo(() => questionSets.find((s) => s.id === questionSetId), [questionSets, questionSetId]);

  // 轮询进行中的任务
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const hasActive = tasks.some((t) => t.status === "RUNNING" || t.status === "QUEUED");
    if (!hasActive) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const res = await fetch("/api/search-tasks?pageSize=30");
      const json = await res.json();
      if (json.ok) setTasks(json.data.tasks);
    }, 3000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [tasks]);

  async function handleCreate() {
    if (name.trim() === "") {
      toast.error("请填写任务名称");
      return;
    }
    if (!questionSetId) {
      toast.error("请选择问题集");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/search-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          brandId: brandId === "none" ? undefined : brandId,
          questionSetId,
          executionMode,
          maxResults: Number(maxResults) || undefined,
          freshness: freshness === "none" ? undefined : freshness,
          industry: industry === "none" ? undefined : industry,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "创建失败");
        return;
      }
      const created = json.data;
      const row: TaskRow = {
        id: created.id,
        name: created.name,
        brandName: brands.find((b) => b.id === brandId)?.name ?? null,
        executionMode,
        provider: executionMode === "REAL" ? "YUANBAO" : "MOCK",
        status: "QUEUED",
        totalItems: created.totalItems,
        successItems: 0,
        failedItems: 0,
        createdAt: created.createdAt,
        finishedAt: null,
        creatorName: "我",
      };
      setTasks((prev) => [row, ...prev]);
      setCreateOpen(false);
      setPendingTask(row);
      setConfirmOpen(true);
    } finally {
      setBusy(false);
    }
  }

  const router = useRouter();

  async function handleStart() {
    if (!pendingTask) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/search-tasks/${pendingTask.id}/start`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "启动失败");
        return;
      }
      toast.success(`任务已开始执行（${pendingTask.totalItems} 个请求）`);
      setConfirmOpen(false);
      setPendingTask(null);
      const refresh = await fetch("/api/search-tasks?pageSize=30");
      const refreshJson = await refresh.json();
      if (refreshJson.ok) setTasks(refreshJson.data.tasks);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">当前数据源：</span>
          <Badge variant="secondary">元宝搜索</Badge>
          <CredentialStatusBadge status={credentialStatus} />
          {!globallyEnabled ? (
            <Badge variant="warning">服务端未启用</Badge>
          ) : !hasCredential ? (
            <span className="text-[12px] text-tertiary">尚未配置 API Key，真实搜索不可用，可先使用模拟模式验证流程</span>
          ) : credentialStatus !== "CONNECTED" ? (
            <Link href="/settings" className="text-xs text-primary hover:underline">
              前往设置页完成连接测试 →
            </Link>
          ) : null}
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> 创建搜索任务
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>任务</TableHead>
              <TableHead className="w-24">品牌</TableHead>
              <TableHead className="w-24">模式</TableHead>
              <TableHead className="w-28">状态</TableHead>
              <TableHead className="w-32">进度（成功/失败/总）</TableHead>
              <TableHead className="w-40">创建时间</TableHead>
              <TableHead className="w-24">创建者</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <EmptyState
                    title="还没有搜索任务"
                    description="创建第一个搜索任务：选择品牌与问题集，确认请求数量后执行。"
                    className="border-none"
                  />
                </TableCell>
              </TableRow>
            ) : (
              tasks.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Link href={`/search-lab/${t.id}`} className="text-sm font-medium hover:underline">
                      {t.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-[12px] text-tertiary">{t.brandName ?? "—"}</TableCell>
                  <TableCell>
                    {t.executionMode === "REAL" ? (
                      <Badge variant="secondary">真实</Badge>
                    ) : (
                      <Badge variant="warning">模拟</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <TaskStatusBadge status={t.status} />
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    {t.successItems}/{t.failedItems}/{t.totalItems}
                  </TableCell>
                  <TableCell className="text-[12px] text-tertiary">{formatDate(t.createdAt)}</TableCell>
                  <TableCell className="text-[12px] text-tertiary">{t.creatorName}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 创建任务 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>创建搜索任务</DialogTitle>
            <DialogDescription>创建任务本身不会发起任何请求；执行前会再次确认。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="taskName">任务名称</Label>
              <Input id="taskName" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：7 月第一轮全量复测" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>品牌（可选）</Label>
                <Select value={brandId} onValueChange={setBrandId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不关联品牌</SelectItem>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>问题集</Label>
                <Select value={questionSetId} onValueChange={setQuestionSetId}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择问题集" />
                  </SelectTrigger>
                  <SelectContent>
                    {questionSets.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}（{s.questionCount} 个启用问题）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>执行模式</Label>
                <Select value={executionMode} onValueChange={(v) => setExecutionMode(v as "REAL" | "MOCK")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="REAL">真实搜索（元宝）</SelectItem>
                    <SelectItem value="MOCK">模拟模式（演示）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>返回条数（Cnt）</Label>
                <Select value={maxResults} onValueChange={setMaxResults}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["10", "20", "30", "40", "50"].map((v) => (
                      <SelectItem key={v} value={v}>
                        {v} 条
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>时效范围（Freshness，可选）</Label>
                <Select value={freshness} onValueChange={setFreshness}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不限</SelectItem>
                    <SelectItem value="d7">最近 7 天</SelectItem>
                    <SelectItem value="d30">最近 30 天</SelectItem>
                    <SelectItem value="m3">最近 3 个月</SelectItem>
                    <SelectItem value="y1">最近 1 年</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>垂直领域（Industry，可选）</Label>
                <Select value={industry} onValueChange={setIndustry}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不限</SelectItem>
                    <SelectItem value="news">新闻</SelectItem>
                    <SelectItem value="gov">政府</SelectItem>
                    <SelectItem value="acad">学术</SelectItem>
                    <SelectItem value="finance">财经</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {executionMode === "REAL" && !realReady ? (
              <div className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning-soft p-3 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  真实模式当前不可用（{!globallyEnabled ? "服务端未启用" : !hasCredential ? "未配置 API Key" : "未通过连接测试或已禁用"}）。
                  你可以先创建任务，但执行会被阻止；或改用模拟模式验证流程。
                </span>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={busy}>
              创建任务
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 执行确认：显示真实请求数量 */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认执行搜索任务</DialogTitle>
            <DialogDescription>执行会产生真实的供应商调用，请确认以下信息。</DialogDescription>
          </DialogHeader>
          {pendingTask ? (
            <div className="space-y-2 rounded-md border bg-surface-muted p-4 text-sm">
              <p>
                任务：<span className="font-medium">{pendingTask.name}</span>
              </p>
              <p>
                搜索问题数量：<span className="font-medium">{pendingTask.totalItems}</span>
              </p>
              <p>
                预计请求数量：<span className="font-medium">{pendingTask.totalItems}</span>（失败重试会产生少量额外请求，全部单独记录）
              </p>
              <div>
                数据源：
                {pendingTask.executionMode === "REAL" ? (
                  <>
                    <Badge variant="secondary" className="ml-1">元宝搜索（真实）</Badge>
                    <span className="ml-2 text-[12px] text-tertiary">会产生实际服务调用</span>
                  </>
                ) : (
                  <>
                    <Badge variant="warning" className="ml-1">模拟模式</Badge>
                    <span className="ml-2 text-[12px] text-tertiary">不产生真实调用</span>
                  </>
                )}
              </div>
              <p className="text-[12px] text-tertiary">当前配置状态：{credentialStatus === "CONNECTED" ? "已连接（通过真实连接测试）" : "未连接"}</p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              暂不执行
            </Button>
            <Button onClick={handleStart} disabled={busy}>
              <Play className="mr-1 h-4 w-4" /> 确认执行
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
