"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskStatusBadge, ItemStatusBadge, MentionStatusBadge, MockBadge } from "@/components/shared/status-badges";
import { InlineAlert, PageHeader, SectionTitle } from "@/components/shared/kpi-card";
import { formatDate, formatDuration, formatPercent } from "@/lib/utils";
import {
  Ban,
  BarChart3,
  ExternalLink,
  GitCompareArrows,
  Grid3X3,
  History,
  Play,
  RefreshCw,
  RotateCcw,
  FileText,
} from "lucide-react";

interface TaskInfo {
  id: string;
  name: string;
  description?: string | null;
  brandId: string | null;
  brandName: string | null;
  executionMode: "REAL" | "MOCK";
  provider: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "PARTIAL_FAILED" | "FAILED" | "CANCELLED";
  totalItems: number;
  successItems: number;
  failedItems: number;
  emptyItems: number;
  parseErrorItems: number;
  failureReason: string | null;
  questionSetName: string | null;
  questionSetVersion: number | null;
  baselineTaskId: string | null;
  source: string;
  params: unknown;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  creatorName: string;
}

interface ItemRow {
  id: string;
  questionText: string;
  category: string | null;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED";
  attempts: number;
  error?: string | null;
  errorCategory?: string | null;
  providerRequestId?: string | null;
  durationMs?: number | null;
  resultCount: number;
  parseErrorCount: number;
  executedAt: string | null;
}

interface ResultRow {
  id: string;
  evidenceId: string | null;
  itemId: string;
  position: number;
  title: string;
  url: string;
  domain?: string | null;
  snippet?: string | null;
  publishedAt?: string | null;
  mentionStatus: string;
  pageType: string;
  sourceRole: string;
  brandMatchBasis: string[];
  officialDomainMatch: boolean;
  isMock: boolean;
}

interface SnapshotRow {
  id: string;
  kind: string;
  ruleVersion: string;
  evidenceCount: number;
  truncated: boolean;
  createdAt: string;
}

interface RetestRow {
  id: string;
  name: string;
  status: string;
  finishedAt: string | null;
}

const PAGE_TYPE_LABELS: Record<string, string> = {
  OFFICIAL_HOMEPAGE: "官网首页",
  PRODUCT_PAGE: "产品页",
  DOCS_PAGE: "文档页",
  BLOG_NEWS: "博客/资讯",
  THIRD_PARTY_MEDIA: "第三方媒体",
  ECOMMERCE_PAGE: "电商页",
  COMMUNITY_FORUM: "社区/论坛",
  OTHER: "其他",
  UNKNOWN: "未知",
};

export function SearchTaskDetail({
  task: initialTask,
  initialItems,
  initialResults,
  initialSnapshots,
  retests: initialRetests,
}: {
  task: TaskInfo;
  initialItems: ItemRow[];
  initialResults: ResultRow[];
  initialSnapshots: SnapshotRow[];
  retests: RetestRow[];
}) {
  const router = useRouter();
  const [task, setTask] = useState(initialTask);
  const [items, setItems] = useState(initialItems);
  const [results, setResults] = useState(initialResults);
  const [snapshots, setSnapshots] = useState(initialSnapshots);
  const [retests] = useState(initialRetests);
  const [busy, setBusy] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [retestOpen, setRetestOpen] = useState(false);
  const [retestName, setRetestName] = useState("");

  useEffect(() => {
    if (task.status !== "RUNNING" && task.status !== "QUEUED") return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/search-tasks/${task.id}`);
      const json = await res.json();
      if (json.ok) {
        setTask((prev) => ({ ...prev, ...json.data.task }));
        setItems(json.data.items);
        const resResults = await fetch(`/api/search-tasks/${task.id}/results`);
        const jsonResults = await resResults.json();
        if (jsonResults.ok) {
          setResults(
            jsonResults.data.results.map((r: Record<string, unknown>) => {
              const evidence = (r.evidence as Array<Record<string, unknown>> | undefined)?.[0];
              return {
                id: r.id as string,
                evidenceId: (evidence?.id as string) ?? null,
                itemId: r.itemId as string,
                position: r.position as number,
                title: r.title as string,
                url: r.url as string,
                domain: r.domain as string | null,
                snippet: r.snippet as string | null,
                publishedAt: r.publishedAt as string | null,
                mentionStatus: (evidence?.mentionStatus as string) ?? "PENDING_REVIEW",
                pageType: (evidence?.pageType as string) ?? "UNKNOWN",
                sourceRole: (evidence?.sourceRole as string) ?? "UNKNOWN",
                brandMatchBasis: (evidence?.brandMatchBasis as string[]) ?? [],
                officialDomainMatch: Boolean(evidence?.officialDomainMatch),
                isMock: r.isMock as boolean,
              };
            })
          );
        }
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [task.id, task.status]);

  async function refresh() {
    const res = await fetch(`/api/search-tasks/${task.id}`);
    const json = await res.json();
    if (json.ok) {
      setTask((prev) => ({ ...prev, ...json.data.task }));
      setItems(json.data.items);
    }
    const snapshotRes = await fetch(`/api/search-tasks/${task.id}/snapshots`);
    const snapshotJson = await snapshotRes.json();
    if (snapshotJson.ok) {
      setSnapshots(
        snapshotJson.data.snapshots.map((s: Record<string, unknown>) => ({
          id: s.id as string,
          kind: s.kind as string,
          ruleVersion: s.ruleVersion as string,
          evidenceCount: s.evidenceCount as number,
          truncated: s.truncated as boolean,
          createdAt: s.createdAt as string,
        }))
      );
    }
  }

  async function handleStart() {
    setBusy(true);
    try {
      const res = await fetch(`/api/search-tasks/${task.id}/start`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "启动失败");
        return;
      }
      toast.success(`任务已开始执行（${task.totalItems} 个请求）`);
      setStartOpen(false);
      setTask((prev) => ({ ...prev, status: "RUNNING", startedAt: new Date().toISOString() }));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    setBusy(true);
    try {
      const res = await fetch(`/api/search-tasks/${task.id}/cancel`, { method: "POST" });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "取消失败");
        return;
      }
      toast.success(task.status === "QUEUED" ? "任务已取消" : "已请求取消，正在执行的问题完成后停止");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRetry() {
    setBusy(true);
    try {
      const res = await fetch(`/api/search-tasks/${task.id}/retry`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "重试失败");
        return;
      }
      toast.success("已开始重试失败的问题（会产生新的真实请求）");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function createRetest() {
    setBusy(true);
    try {
      const res = await fetch(`/api/search-tasks/${task.id}/retest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: retestName.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "创建复测失败");
        return;
      }
      toast.success("复测任务已创建（尚未执行）");
      setRetestOpen(false);
      router.push(`/search-lab/${json.data.task.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function snapshot(kind: "COLLECTION" | "RECOMPUTE") {
    setBusy(true);
    try {
      const res = await fetch(`/api/search-tasks/${task.id}/snapshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "快照操作失败");
        return;
      }
      toast.success(kind === "RECOMPUTE" ? "已按当前规则重新分析并生成快照" : "采集快照已生成");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const doneCount = items.filter((i) => i.status === "SUCCESS" || i.status === "FAILED" || i.status === "CANCELLED").length;
  const progress = task.totalItems > 0 ? doneCount / task.totalItems : 0;
  const finished = task.status === "COMPLETED" || task.status === "PARTIAL_FAILED";
  const canRetest = task.status !== "QUEUED" && task.status !== "RUNNING";

  return (
    <div>
      <PageHeader
        title={task.name}
        description={task.description ?? undefined}
        actions={
          <>
            {task.status === "QUEUED" ? (
              <Button onClick={() => setStartOpen(true)} disabled={busy}>
                <Play className="mr-1 h-4 w-4" /> 开始执行
              </Button>
            ) : null}
            {task.status === "RUNNING" || task.status === "QUEUED" ? (
              <Button variant="outline" onClick={handleCancel} disabled={busy}>
                <Ban className="mr-1 h-4 w-4" /> 取消任务
              </Button>
            ) : null}
            {task.failedItems > 0 && task.status !== "RUNNING" ? (
              <Button variant="outline" onClick={handleRetry} disabled={busy}>
                <RefreshCw className="mr-1 h-4 w-4" /> 重试失败项（{task.failedItems}）
              </Button>
            ) : null}
            {canRetest ? (
              <Button variant="outline" onClick={() => { setRetestName(`${task.name} · 复测 ${new Date().toISOString().slice(0, 10)}`); setRetestOpen(true); }} disabled={busy}>
                <RotateCcw className="mr-1 h-4 w-4" /> 创建复测
              </Button>
            ) : null}
            {finished ? (
              <Button variant="outline" asChild>
                <Link href={`/reports?taskId=${task.id}`}>
                  <FileText className="mr-1 h-4 w-4" /> 生成报告
                </Link>
              </Button>
            ) : null}
            {finished && task.brandId ? (
              <Button variant="outline" asChild>
                <Link href={`/matrix?brandId=${task.brandId}`}>
                  <Grid3X3 className="mr-1 h-4 w-4" /> 问题矩阵
                </Link>
              </Button>
            ) : null}
            <Button asChild>
              <Link href="/search-lab">
                <BarChart3 className="mr-1 h-4 w-4" /> 任务列表
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-[12px] text-tertiary">状态</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <TaskStatusBadge status={task.status} />
              <MockBadge isMock={task.executionMode === "MOCK"} />
            </div>
            <p className="mt-1.5 text-[10px] text-quaternary">
              {task.source === "SCHEDULE" ? "定时采集" : task.source === "CHAT" ? "对话平台" : "搜索实验室"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[12px] text-tertiary">进度</p>
            <p className="mt-1.5 text-xl font-semibold">
              {doneCount}/{task.totalItems}
              <span className="ml-2 text-[13px] text-muted-foreground">{formatPercent(progress)}</span>
            </p>
            <p className="mt-1 text-[10px] text-quaternary">空结果 {task.emptyItems} · 解析异常 {task.parseErrorItems}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[12px] text-tertiary">成功 / 失败</p>
            <p className="mt-1.5 text-xl font-semibold">
              <span className="text-success">{task.successItems}</span>
              <span className="mx-1 text-muted-foreground">/</span>
              <span className={task.failedItems > 0 ? "text-destructive" : ""}>{task.failedItems}</span>
            </p>
            <p className="mt-1 text-[10px] text-quaternary">
              {task.questionSetName ?? "—"} · v{task.questionSetVersion ?? "未知"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[12px] text-tertiary">数据源 / 品牌</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1 text-sm">
              <Badge variant="secondary">{task.provider}</Badge>
              <span className="text-muted-foreground">{task.brandName ?? "未关联"}</span>
            </div>
            {task.baselineTaskId ? (
              <Link href={`/search-lab/${task.baselineTaskId}`} className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
                <History className="h-3 w-3" /> 查看基线轮次
              </Link>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {task.failureReason ? (
        <InlineAlert tone="danger" title="失败原因" className="mt-3">
          {task.failureReason}。失败问题未计入指标分母，也不会被当作「品牌未出现」。
        </InlineAlert>
      ) : null}
      {task.status === "PARTIAL_FAILED" ? (
        <InlineAlert tone="warning" title="部分成功" className="mt-3">
          成功 {task.successItems} 个、失败 {task.failedItems} 个。指标只使用成功且返回结果的问题；失败问题单独展示，可重试。
        </InlineAlert>
      ) : null}
      {task.status === "RUNNING" ? (
        <p className="mt-3 rounded-md border border-warning/25 bg-warning-soft px-3 py-2 text-xs text-warning">
          任务执行中，页面每 3 秒自动刷新进度。重试产生的额外请求都会单独记录在「尝试次数」中。
        </p>
      ) : null}

      {retests.length > 0 ? (
        <div className="mt-3 rounded-xl border border-border bg-card px-4 py-3">
          <SectionTitle title="后续复测" description="同一基线下的复测任务；可逐轮比较。" className="mb-2" />
          <div className="flex flex-wrap gap-2">
            {retests.map((retest) => (
              <Link key={retest.id} href={`/search-lab/${retest.id}`} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] hover:bg-surface-muted">
                {retest.name}
                <Badge variant="muted" className="text-[9px]">{retest.status}</Badge>
                <GitCompareArrows className="h-3 w-3" />
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <Tabs defaultValue="items" className="mt-6">
        <TabsList>
          <TabsTrigger value="items">问题执行明细</TabsTrigger>
          <TabsTrigger value="results">搜索结果（{results.length}）</TabsTrigger>
          <TabsTrigger value="snapshots">分析快照（{snapshots.length}）</TabsTrigger>
        </TabsList>
        <TabsContent value="items">
          <div className="rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>问题</TableHead>
                  <TableHead className="w-24">类别</TableHead>
                  <TableHead className="w-24">状态</TableHead>
                  <TableHead className="w-16">结果数</TableHead>
                  <TableHead className="w-16">解析异常</TableHead>
                  <TableHead className="w-20">尝试</TableHead>
                  <TableHead className="w-20">耗时</TableHead>
                  <TableHead className="w-44">RequestId / 错误</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-xs">
                      <span className="line-clamp-2 text-sm">{item.questionText}</span>
                    </TableCell>
                    <TableCell className="text-[11px] text-tertiary">{item.category ?? "未分类"}</TableCell>
                    <TableCell>
                      <ItemStatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.resultCount}</TableCell>
                    <TableCell className="font-mono text-xs">{item.parseErrorCount}</TableCell>
                    <TableCell className="font-mono text-xs">{item.attempts}</TableCell>
                    <TableCell className="text-[12px] text-tertiary">{formatDuration(item.durationMs)}</TableCell>
                    <TableCell className="max-w-44">
                      {item.error ? (
                        <p className="text-xs text-destructive" title={item.error ?? ""}>
                          <span className="line-clamp-2">{item.error}</span>
                        </p>
                      ) : item.providerRequestId ? (
                        <p className="truncate font-mono text-[10px] text-muted-foreground">{item.providerRequestId}</p>
                      ) : (
                        <span className="text-[12px] text-tertiary">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="results">
          {results.length === 0 ? (
            <p className="rounded-lg border border-dashed py-12 text-center text-[13px] text-muted-foreground">
              暂无搜索结果{task.status === "QUEUED" ? "（任务尚未执行）" : ""}
            </p>
          ) : (
            <div className="space-y-3">
              {results.map((r) => (
                <Card key={r.id}>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{r.title}</p>
                        <p className="mt-0.5 truncate font-mono text-[12px] text-tertiary">
                          {r.domain ?? "—"}
                          {r.publishedAt ? ` · ${r.publishedAt}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <Badge variant="info" className="text-[10px]">{PAGE_TYPE_LABELS[r.pageType] ?? r.pageType}</Badge>
                        {r.officialDomainMatch ? <Badge variant="success" className="text-[10px]">官网</Badge> : null}
                        <MentionStatusBadge status={r.mentionStatus as never} />
                        <MockBadge isMock={r.isMock} />
                        {r.evidenceId ? (
                          <Link href={`/evidence/${r.evidenceId}`} className="text-xs text-primary hover:underline">
                            证据详情
                          </Link>
                        ) : null}
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          打开 <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                    {r.snippet ? <p className="mt-2 line-clamp-3 text-[13px] text-muted-foreground">{r.snippet}</p> : null}
                    {r.brandMatchBasis.length > 0 ? (
                      <p className="mt-1 text-[10px] text-quaternary">匹配依据：{r.brandMatchBasis.join("、")}</p>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="snapshots">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void snapshot("COLLECTION")} disabled={busy || task.status === "RUNNING" || task.status === "QUEUED"}>
                <History className="mr-1 h-3.5 w-3.5" /> 补建采集快照
              </Button>
              <Button size="sm" variant="outline" onClick={() => void snapshot("RECOMPUTE")} disabled={busy || task.status === "RUNNING" || task.status === "QUEUED"}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> 用当前规则重算
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/snapshots?taskId=${task.id}`}>查看全部快照</Link>
              </Button>
            </div>
            {snapshots.length === 0 ? (
              <p className="rounded-lg border border-dashed py-10 text-center text-[12px] text-tertiary">
                还没有分析快照。任务完成时会自动创建；也可手动补建。
              </p>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {snapshots.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-[11px]">
                    <Badge variant={s.kind === "COLLECTION" ? "info" : "secondary"}>
                      {s.kind === "COLLECTION" ? "采集快照" : "重算快照"}
                    </Badge>
                    <span className="font-mono text-[10px] text-tertiary">{s.ruleVersion}</span>
                    <span className="text-quaternary">证据 {s.evidenceCount} 条{s.truncated ? "（截断）" : ""}</span>
                    <span className="ml-auto text-quaternary">{formatDate(s.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
            <InlineAlert tone="info">
              快照保存分析结果与当时的问题文本；重算会生成新的 RECOMPUTE 快照，不覆盖历史 COLLECTION 快照，也不修改原始搜索结果。
            </InlineAlert>
          </div>
        </TabsContent>
      </Tabs>

      <p className="mt-6 text-[12px] text-tertiary">
        任务创建于 {formatDate(task.createdAt)}，创建者 {task.creatorName}。
        {task.startedAt ? ` 开始执行于 ${formatDate(task.startedAt)}。` : ""}
        {task.finishedAt ? ` 完成于 ${formatDate(task.finishedAt)}。` : ""}
      </p>

      <Dialog open={startOpen} onOpenChange={setStartOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认执行搜索任务</DialogTitle>
            <DialogDescription>执行会产生真实的供应商调用（模拟模式除外），请确认以下信息。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-md border bg-surface-muted p-4 text-sm">
            <p>任务：{task.name}</p>
            <p>搜索问题数量：{task.totalItems}</p>
            <p>预计请求数量：{task.totalItems}（失败重试会产生少量额外请求，全部单独记录）</p>
            <p>模式：{task.executionMode === "REAL" ? "真实搜索（元宝）" : "模拟模式"}</p>
            <p className="text-[12px] text-tertiary">执行前请确认数据源已连接；否则任务会被标记失败，而不是伪造结果。</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStartOpen(false)}>暂不执行</Button>
            <Button onClick={handleStart} disabled={busy}>
              <Play className="mr-1 h-4 w-4" /> 确认执行
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={retestOpen} onOpenChange={setRetestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建复测任务</DialogTitle>
            <DialogDescription>使用相同问题集版本与采集参数创建一轮新任务；创建后仍需确认执行。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-[12px] text-secondary-soft">复测任务名称</label>
            <input
              value={retestName}
              onChange={(e) => setRetestName(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-card px-3 text-[13px]"
              maxLength={100}
            />
            <p className="rounded-md bg-surface-muted px-3 py-2 text-[12px] text-tertiary">
              预计请求数量：{task.totalItems}；不会复用本轮结果，所有问题都会重新搜索。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRetestOpen(false)}>取消</Button>
            <Button onClick={createRetest} disabled={busy}>
              <RotateCcw className="mr-1 h-4 w-4" /> 创建复测
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
