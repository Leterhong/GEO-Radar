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
import { ArrowRight, CalendarClock, Plus } from "lucide-react";

interface EventRow {
  id: string;
  name: string;
  brandName: string | null;
  occurredAt: string;
  contentChanged: string | null;
  pageUrls: string[];
  note: string | null;
  baselineTaskId: string | null;
  retestTaskId: string | null;
}

interface TaskOption {
  id: string;
  name: string;
  finishedAt: string | null;
}

export function OptimizationEventsPanel({
  brands,
  events,
  tasks,
}: {
  brands: Array<{ id: string; name: string }>;
  events: EventRow[];
  tasks: TaskOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "none");
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [contentChanged, setContentChanged] = useState("");
  const [pageUrls, setPageUrls] = useState("");
  const [baselineTaskId, setBaselineTaskId] = useState("none");
  const [retestTaskId, setRetestTaskId] = useState("none");
  const [saving, setSaving] = useState(false);
  const [reportingId, setReportingId] = useState<string | null>(null);

  async function createReport(event: EventRow) {
    if (!event.baselineTaskId || !event.retestTaskId) {
      toast.error("请先关联优化前和优化后任务");
      return;
    }
    setReportingId(event.id);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: event.retestTaskId,
          compareTaskId: event.baselineTaskId,
          title: `优化效果验证：${event.name}`,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "生成报告失败");
        return;
      }
      toast.success("验证报告已生成");
      window.location.href = `/reports/${json.data.id}`;
    } finally {
      setReportingId(null);
    }
  }

  async function createEvent() {
    if (!name.trim()) {
      toast.error("请填写事件名称");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/optimization-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          brandId: brandId === "none" ? undefined : brandId,
          occurredAt,
          contentChanged: contentChanged.trim() || undefined,
          pageUrls: pageUrls.split(/\r?\n/).map((v) => v.trim()).filter(Boolean),
          baselineTaskId: baselineTaskId === "none" ? undefined : baselineTaskId,
          retestTaskId: retestTaskId === "none" ? undefined : retestTaskId,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "创建失败");
        return;
      }
      toast.success("优化事件已记录，可关联前后两轮任务查看变化");
      setOpen(false);
      setName("");
      setContentChanged("");
      setPageUrls("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">优化事件与效果验证</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            记录页面修改，并关联优化前后两轮真实任务。这里只展示时间关联与页面变化，不证明因果关系。
          </p>
        </div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> 记录优化事件
        </Button>
      </div>

      {events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-10 text-center">
          <CalendarClock className="mx-auto h-5 w-5 text-tertiary" />
          <p className="mt-2 text-sm font-medium">暂无优化事件</p>
          <p className="mt-1 text-[13px] text-muted-foreground">记录一次页面修改后，可关联前后任务查看页面是否重新出现。</p>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <Card key={event.id}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{event.name}</p>
                      {event.brandName ? <Badge variant="secondary">{event.brandName}</Badge> : null}
                      <span className="text-[11px] text-tertiary">{formatDate(event.occurredAt)}</span>
                    </div>
                    {event.contentChanged ? (
                      <p className="mt-2 line-clamp-2 text-[13px] text-muted-foreground">{event.contentChanged}</p>
                    ) : null}
                    {event.pageUrls.length > 0 ? (
                      <p className="mt-2 truncate font-mono text-[11px] text-tertiary">{event.pageUrls.join(" · ")}</p>
                    ) : null}
                  </div>
                  {event.baselineTaskId && event.retestTaskId ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" asChild>
                        <a href={`/compare?baseline=${event.baselineTaskId}&retest=${event.retestTaskId}`}>
                          查看前后对比 <ArrowRight className="ml-1 h-3.5 w-3.5" />
                        </a>
                      </Button>
                      <Button size="sm" onClick={() => createReport(event)} disabled={reportingId === event.id}>
                        {reportingId === event.id ? "生成中…" : "生成验证报告"}
                      </Button>
                    </div>
                  ) : (
                    <Badge variant="muted">未关联前后任务</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>记录优化事件</DialogTitle>
            <DialogDescription>记录页面修改并使用同一问题集复测；前后对比只代表观察变化。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="eventName">事件名称</Label>
              <Input id="eventName" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：产品页补充适用场景与 FAQ" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>关联品牌</Label>
                <Select value={brandId} onValueChange={setBrandId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不关联</SelectItem>
                    {brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="eventDate">发生时间</Label>
                <Input id="eventDate" type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eventContent">修改内容摘要</Label>
              <Textarea id="eventContent" value={contentChanged} onChange={(e) => setContentChanged(e.target.value)} className="min-h-20" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eventPages">修改页面 URL（每行一个）</Label>
              <Textarea id="eventPages" value={pageUrls} onChange={(e) => setPageUrls(e.target.value)} className="min-h-20 font-mono text-xs" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>优化前任务</Label>
                <Select value={baselineTaskId} onValueChange={setBaselineTaskId}>
                  <SelectTrigger><SelectValue placeholder="选择任务" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不关联</SelectItem>
                    {tasks.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>优化后任务</Label>
                <Select value={retestTaskId} onValueChange={setRetestTaskId}>
                  <SelectTrigger><SelectValue placeholder="选择任务" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不关联</SelectItem>
                    {tasks.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={createEvent} disabled={saving}>{saving ? "保存中…" : "保存事件"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
