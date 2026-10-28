"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MentionStatusBadge, MockBadge } from "@/components/shared/status-badges";
import { EmptyState } from "@/components/shared/kpi-card";
import { formatDate } from "@/lib/utils";
import { Search, Download, ExternalLink, ClipboardCheck, RefreshCw } from "lucide-react";

interface Brand { id: string; name: string }
interface TaskRef { id: string; name: string }
interface EvidenceRow {
  id: string;
  title: string;
  url: string;
  domain?: string | null;
  snippet?: string | null;
  publishedAt?: string | null;
  collectedAt: string;
  mentionStatus: string;
  isMock: boolean;
  taskName: string;
  matchedTerms?: string[];
  competitorMatches?: string[];
  tags?: string[];
  relevance?: string;
  pageType?: string;
  sourceRole?: string;
  brandMatchBasis?: string[];
  officialDomainMatch?: boolean;
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

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "CONFIRMED_BRAND", label: "确认本品牌" },
  { value: "CONFIRMED_COMPETITOR", label: "确认竞品" },
  { value: "PENDING_REVIEW", label: "待复核" },
  { value: "IRRELEVANT", label: "无关结果" },
  { value: "AMBIGUOUS", label: "存在歧义" },
];

export function EvidenceClient({ brands, tasks }: { brands: Brand[]; tasks: TaskRef[] }) {
  const [rows, setRows] = useState<EvidenceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [brandId, setBrandId] = useState("all");
  const [taskId, setTaskId] = useState("all");
  const [status, setStatus] = useState("all");
  const [pageType, setPageType] = useState("all");
  const [loading, setLoading] = useState(true);
  const [reviewTarget, setReviewTarget] = useState<EvidenceRow | null>(null);
  const [reviewStatus, setReviewStatus] = useState("CONFIRMED_BRAND");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewTags, setReviewTags] = useState("");
  const [reviewRelevance, setReviewRelevance] = useState("UNKNOWN");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reanalyzing, setReanalyzing] = useState(false);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) params.set("search", search);
      if (brandId !== "all") params.set("brandId", brandId);
      if (taskId !== "all") params.set("taskId", taskId);
      if (status !== "all") params.set("mentionStatus", status);
      if (pageType !== "all") params.set("pageType", pageType);
      const res = await fetch(`/api/evidence?${params.toString()}`);
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "加载失败");
        return;
      }
      setRows(
        json.data.evidence.map((e: Record<string, unknown>) => ({
          id: e.id as string,
          title: e.title as string,
          url: e.url as string,
          domain: e.domain as string | null,
          snippet: e.snippet as string | null,
          publishedAt: e.publishedAt as string | null,
          collectedAt: e.collectedAt as string,
          mentionStatus: e.mentionStatus as string,
          isMock: e.isMock as boolean,
          taskName: ((e.task as { name?: string })?.name as string) ?? "",
          matchedTerms: e.matchedTerms as string[],
          competitorMatches: e.competitorMatches as string[],
          tags: (e.tags as string[]) ?? [],
          relevance: (e.relevance as string) ?? "UNKNOWN",
          pageType: (e.pageType as string) ?? "UNKNOWN",
          sourceRole: (e.sourceRole as string) ?? "UNKNOWN",
          brandMatchBasis: (e.brandMatchBasis as string[]) ?? [],
          officialDomainMatch: Boolean(e.officialDomainMatch),
        }))
      );
      setTotal(json.data.total);
    } finally {
      setLoading(false);
    }
  }, [page, search, brandId, taskId, status, pageType]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitReview() {
    if (!reviewTarget) return;
    const res = await fetch(`/api/evidence/${reviewTarget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mentionStatus: reviewStatus,
        reviewNote,
        relevance: reviewRelevance,
        tags: reviewTags
          .split(/[,，、\s]+/)
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 10),
      }),
    });
    const json = await res.json();
    if (!json.ok) {
      toast.error(json?.error?.message ?? "复核失败");
      return;
    }
    toast.success("已保存（原始结果不被覆盖）");
    setReviewTarget(null);
    setReviewNote("");
    setReviewTags("");
    setReviewRelevance("UNKNOWN");
    void load();
  }

  async function handleExport() {
    const res = await fetch("/api/evidence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filters: {
          ...(brandId !== "all" ? { brandId } : {}),
          ...(taskId !== "all" ? { taskId } : {}),
          ...(status !== "all" ? { mentionStatus: status } : {}),
          ...(pageType !== "all" ? { pageType } : {}),
        },
      }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `georadar-evidence-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleReanalyzeLegacy() {
    setReanalyzing(true);
    try {
      const res = await fetch("/api/evidence/reanalyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "重算失败");
        return;
      }
      toast.success(
        `已重算 ${json.data.tasks} 个历史任务、${json.data.updated} 条证据（原始结果未被修改，已生成 RECOMPUTE 快照）`
      );
      await load();
    } finally {
      setReanalyzing(false);
    }
  }

  async function handleBatchArchive() {    if (selectedIds.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/evidence/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, action: "archive" }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "批量操作失败");
        return;
      }
      toast.success(
        `已移出 ${json.data.updated} 条${json.data.skipped ? `，跳过 ${json.data.skipped} 条（无权限或不存在）` : ""}`
      );
      setSelectedIds([]);
      await load();
    } finally {
      setLoading(false);
    }
  }

  const allSelected = rows.length > 0 && selectedIds.length === rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder="搜索标题或摘要…"
            className="pl-8"
          />
        </div>
        <Select
          value={brandId}
          onValueChange={(v) => {
            setPage(1);
            setBrandId(v);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="品牌" />
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
        <Select
          value={taskId}
          onValueChange={(v) => {
            setPage(1);
            setTaskId(v);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="任务" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部任务</SelectItem>
            {tasks.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setPage(1);
            setStatus(v);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={pageType}
          onValueChange={(v) => {
            setPage(1);
            setPageType(v);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部页面类型</SelectItem>
            {Object.entries(PAGE_TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={handleExport}>
          <Download className="mr-1 h-4 w-4" /> 导出 CSV
        </Button>
        <Button variant="outline" onClick={handleReanalyzeLegacy} disabled={reanalyzing}>
          <RefreshCw className={`mr-1 h-4 w-4 ${reanalyzing ? "animate-spin" : ""}`} /> 重算历史证据
        </Button>
        <Button variant="outline" onClick={handleBatchArchive} disabled={selectedIds.length === 0}>
          批量移出（{selectedIds.length}）
        </Button>
      </div>

      {loading ? (
        <div className="rounded-lg border py-16 text-center text-[13px] text-muted-foreground">加载中…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="暂无证据"
          description="执行真实搜索任务后，返回的网页结果会自动归档为证据。模拟任务的证据带有模拟标记，不进入真实统计。"
          action={
            <Button asChild>
              <a href="/search-lab">前往搜索实验室</a>
            </Button>
          }
        />
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <input
                    type="checkbox"
                    aria-label="全选当前页"
                    checked={allSelected}
                    onChange={(e) => setSelectedIds(e.target.checked ? rows.map((r) => r.id) : [])}
                    className="h-3.5 w-3.5 rounded border-input accent-[var(--primary)]"
                  />
                </TableHead>
                <TableHead>标题 / 摘要</TableHead>
                <TableHead className="w-32">页面类型</TableHead>
                <TableHead className="w-28">域名</TableHead>
                <TableHead className="w-24">相关性</TableHead>
                <TableHead className="w-32">提及状态</TableHead>
                <TableHead className="w-20">数据</TableHead>
                <TableHead className="w-36">采集时间</TableHead>
                <TableHead className="w-24">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`选择 ${e.title}`}
                      checked={selectedIds.includes(e.id)}
                      onChange={(ev) =>
                        setSelectedIds((prev) => (ev.target.checked ? [...prev, e.id] : prev.filter((id) => id !== e.id)))
                      }
                      className="h-3.5 w-3.5 rounded border-input accent-[var(--primary)]"
                    />
                  </TableCell>
                  <TableCell className="max-w-sm">
                    <Link
                      href={`/evidence/${e.id}`}
                      className="line-clamp-1 text-sm font-medium hover:text-primary hover:underline"
                    >
                      {e.title}
                    </Link>
                    {e.snippet ? <p className="mt-0.5 line-clamp-1 text-[12px] text-tertiary">{e.snippet}</p> : null}
                    {(e.brandMatchBasis ?? []).length > 0 ? (
                      <p className="mt-0.5 line-clamp-1 text-[10px] text-quaternary">依据：{e.brandMatchBasis!.join("、")}</p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant="info" className="text-[10px]">
                      {PAGE_TYPE_LABELS[e.pageType ?? "UNKNOWN"] ?? "未知"}
                    </Badge>
                    {e.officialDomainMatch ? (
                      <Badge variant="success" className="ml-1 text-[10px]">
                        官网
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-[12px] text-tertiary">{e.domain ?? "—"}</TableCell>
                  <TableCell className="text-[11px] text-tertiary">
                    {({ HIGH: "高", MEDIUM: "中", LOW: "低", UNKNOWN: "—" } as Record<string, string>)[e.relevance ?? "UNKNOWN"] ?? "—"}
                  </TableCell>
                  <TableCell>
                    <MentionStatusBadge status={e.mentionStatus as never} />
                    {(e.tags ?? []).length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {e.tags!.slice(0, 2).map((tag) => (
                          <Badge key={tag} variant="muted" className="text-[9px]">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <MockBadge isMock={e.isMock} />
                  </TableCell>
                  <TableCell className="text-[12px] text-tertiary">{formatDate(e.collectedAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setReviewTarget(e);
                          setReviewStatus(e.mentionStatus);
                          setReviewTags((e.tags ?? []).join("、"));
                          setReviewRelevance(e.relevance ?? "UNKNOWN");
                          setReviewNote("");
                        }}
                        aria-label="人工复核"
                        title="人工复核"
                      >
                        <ClipboardCheck className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                      </Button>
                      <a
                        href={e.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                        aria-label="打开来源"
                        title="打开来源（安全外链）"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between border-t px-4 py-3 text-[13px] text-muted-foreground">
            <span>
              共 {total} 条 · 第 {page}/{totalPages} 页
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                上一页
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                下一页
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 人工复核 */}
      <Dialog open={reviewTarget !== null} onOpenChange={(open) => !open && setReviewTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>人工复核证据</DialogTitle>
            <DialogDescription>
              人工判断会覆盖规则识别的展示状态，但原始识别结果保留在记录中（detectionMethod 改为 MANUAL）。
            </DialogDescription>
          </DialogHeader>
          {reviewTarget ? (
            <div className="space-y-3">
              <Card>
                <CardContent className="p-3">
                  <p className="text-sm font-medium">{reviewTarget.title}</p>
                  <p className="mt-1 break-all font-mono text-[12px] text-tertiary">{reviewTarget.url}</p>
                  <Link href={`/evidence/${reviewTarget.id}`} className="mt-2 inline-block text-[12px] text-primary hover:underline">
                    查看证据详情与复核历史 →
                  </Link>
                </CardContent>
              </Card>
              <div className="space-y-1.5">
                <Label>确认状态</Label>
                <Select value={reviewStatus} onValueChange={setReviewStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CONFIRMED_BRAND">确认是本品牌</SelectItem>
                    <SelectItem value="CONFIRMED_COMPETITOR">确认是竞品</SelectItem>
                    <SelectItem value="IRRELEVANT">无关结果</SelectItem>
                    <SelectItem value="AMBIGUOUS">存在歧义</SelectItem>
                    <SelectItem value="PENDING_REVIEW">待人工复核</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>相关性</Label>
                  <Select value={reviewRelevance} onValueChange={setReviewRelevance}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HIGH">高</SelectItem>
                      <SelectItem value="MEDIUM">中</SelectItem>
                      <SelectItem value="LOW">低</SelectItem>
                      <SelectItem value="UNKNOWN">未标注</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reviewTags">标签（逗号或顿号分隔）</Label>
                  <Input id="reviewTags" value={reviewTags} onChange={(e) => setReviewTags(e.target.value)} placeholder="例如：官网, 行业报告" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reviewNote">复核备注（可选）</Label>
                <Textarea id="reviewNote" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
              </div>
              {reviewTarget.matchedTerms && reviewTarget.matchedTerms.length > 0 ? (
                <p className="text-[12px] text-tertiary">规则匹配词：{reviewTarget.matchedTerms.join("、")}</p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewTarget(null)}>
              取消
            </Button>
            <Button onClick={submitReview}>保存复核</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
