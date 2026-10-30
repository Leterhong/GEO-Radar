"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils";
import { Sparkles, Plus, CheckCircle2, CircleDot, XCircle } from "lucide-react";

interface TaskRow {
  id: string;
  title: string;
  description: string;
  pageUrl: string | null;
  type: string;
  priority: string;
  status: string;
  brandName: string | null;
  evidenceCount: number;
  questionCount: number;
  generatedBy: string;
  createdAt: string;
  dueDate: string | null;
}

const PRIORITY_LABEL: Record<string, string> = {
  LOW: "低",
  MEDIUM: "中",
  HIGH: "高",
  CRITICAL: "紧急",
};

const STATUS_LABEL: Record<string, string> = {
  OPEN: "待处理",
  IN_PROGRESS: "进行中",
  NEEDS_VERIFICATION: "待验证",
  DONE: "已完成",
  DISMISSED: "已忽略",
};

const TYPE_LABEL: Record<string, string> = {
  BRAND_MISSING: "品牌未出现在相关结果",
  COMPETITOR_ADVANTAGE: "竞品信息更完整",
  OFFICIAL_SITE_LOW: "官网来源覆盖不足",
  OFFICIAL_SITE_MISSING: "缺少官网配置",
  MANUAL: "手动创建",
};

export function OptimizationClient({ brands, tasks }: { brands: Array<{ id: string; name: string }>; tasks: TaskRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(tasks);
  const [generating, setGenerating] = useState(false);
  const [generateBrand, setGenerateBrand] = useState(brands[0]?.id ?? "");
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [type, setType] = useState("MANUAL");
  const [priority, setPriority] = useState("MEDIUM");
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "none");

  async function handleGenerate() {
    if (!generateBrand) {
      toast.error("请先创建品牌");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch(`/api/recommendations?generate=true&brandId=${generateBrand}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "生成失败");
        return;
      }
      const data = json.data as { generated: number; skippedExisting: number };
      if (data.generated === 0 && data.skippedExisting > 0) {
        toast.info(`没有新的建议（已有 ${data.skippedExisting} 条同类型待处理建议）`);
      } else {
        toast.success(`已生成 ${data.generated} 条新建议`);
      }
      router.refresh();
    } finally {
      setGenerating(false);
    }
  }

  async function handleCreate() {
    if (title.trim() === "" || description.trim() === "") {
      toast.error("请填写标题和描述");
      return;
    }
    const res = await fetch("/api/recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), description: description.trim(), pageUrl: pageUrl.trim(), type, priority, brandId: brandId === "none" ? "" : brandId }),
    });
    const json = await res.json();
    if (!json.ok) {
      toast.error(json?.error?.message ?? "创建失败");
      return;
    }
    toast.success("优化任务已创建");
    setCreateOpen(false);
    setTitle("");
    setDescription("");
    setPageUrl("");
    router.refresh();
  }

  async function updateStatus(id: string, status: string) {
    const res = await fetch(`/api/recommendations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const json = await res.json();
    if (!json.ok) {
      toast.error(json?.error?.message ?? "更新失败");
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    toast.success("状态已更新");
  }

  const statusOrder = ["OPEN", "IN_PROGRESS", "NEEDS_VERIFICATION", "DONE", "DISMISSED"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={generateBrand} onValueChange={setGenerateBrand}>
          <SelectTrigger className="w-44">
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
        <Button onClick={handleGenerate} disabled={generating}>
          <Sparkles className="mr-1 h-4 w-4" /> {generating ? "分析中…" : "从证据生成建议"}
        </Button>
        <Button variant="outline" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> 手动创建任务
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-14 text-center">
          <p className="text-sm font-medium">暂无优化任务</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13px] text-muted-foreground">
            完成至少一轮真实搜索后，规则引擎可以从证据中生成建议（例如：品牌未出现在部分问题的结果中、官网来源覆盖不足、竞品在特定问题中出现）。
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {statusOrder.map((status) => {
            const group = rows.filter((r) => r.status === status);
            if (group.length === 0) return null;
            return (
              <div key={status}>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  {status === "OPEN" ? <CircleDot className="h-4 w-4 text-warning" /> : null}
                  {status === "IN_PROGRESS" ? <CircleDot className="h-4 w-4 text-chart-2" /> : null}
                  {status === "NEEDS_VERIFICATION" ? <CircleDot className="h-4 w-4 text-warning" /> : null}
                  {status === "DONE" ? <CheckCircle2 className="h-4 w-4 text-success" /> : null}
                  {status === "DISMISSED" ? <XCircle className="h-4 w-4 text-muted-foreground" /> : null}
                  {STATUS_LABEL[status]}
                  <Badge variant="muted">{group.length}</Badge>
                </h3>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {group.map((t) => (
                    <Card key={t.id}>
                      <CardContent className="p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{t.title}</p>
                            <p className="mt-1 line-clamp-3 text-[12px] text-tertiary">{t.description}</p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <Badge variant={t.priority === "CRITICAL" || t.priority === "HIGH" ? "warning" : "muted"}>
                              {PRIORITY_LABEL[t.priority] ?? t.priority}优先级
                            </Badge>
                            {t.generatedBy === "RULE_ENGINE" ? (
                              <Badge variant="secondary">规则生成</Badge>
                            ) : (
                              <Badge variant="muted">手动</Badge>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-tertiary">
                          <span>类型：{TYPE_LABEL[t.type] ?? t.type}</span>
                          {t.brandName ? <span>品牌：{t.brandName}</span> : null}
                          <span>关联证据 {t.evidenceCount} 条</span>
                          <span>关联问题 {t.questionCount} 个</span>
                          {t.pageUrl ? (
                            <a href={t.pageUrl} target="_blank" rel="noopener noreferrer nofollow" className="max-w-full truncate text-primary hover:underline">
                              目标页面
                            </a>
                          ) : null}
                          <span>创建于 {formatDate(t.createdAt)}</span>
                        </div>
                        <div className="mt-3 flex gap-2">
                          {t.status === "OPEN" ? (
                            <Button size="sm" variant="outline" onClick={() => updateStatus(t.id, "IN_PROGRESS")}>
                              开始处理
                            </Button>
                          ) : null}
                          {t.status === "IN_PROGRESS" ? (
                            <Button size="sm" variant="outline" onClick={() => updateStatus(t.id, "NEEDS_VERIFICATION")}>
                              提交验证
                            </Button>
                          ) : null}
                          {t.status === "NEEDS_VERIFICATION" ? (
                            <Button size="sm" variant="outline" onClick={() => updateStatus(t.id, "DONE")}>
                              验证通过
                            </Button>
                          ) : null}
                          {t.status === "OPEN" || t.status === "IN_PROGRESS" || t.status === "NEEDS_VERIFICATION" ? (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => updateStatus(t.id, "DONE")}>
                                标记完成
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => updateStatus(t.id, "DISMISSED")}>
                                忽略
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>手动创建优化任务</DialogTitle>
            <DialogDescription>建议填写明确的操作步骤，便于优化后复测对比。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="optTitle">标题</Label>
              <Input id="optTitle" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="optDesc">描述</Label>
              <Textarea id="optDesc" value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-24" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="optPage">关联页面 URL（可选）</Label>
              <Input id="optPage" value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} placeholder="https://example.com/products/..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>优先级</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">低</SelectItem>
                    <SelectItem value="MEDIUM">中</SelectItem>
                    <SelectItem value="HIGH">高</SelectItem>
                    <SelectItem value="CRITICAL">紧急</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>关联品牌</Label>
                <Select value={brandId} onValueChange={setBrandId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不关联</SelectItem>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
