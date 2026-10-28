"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPercent } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";

interface CompetitorRow {
  id: string;
  name: string;
  websiteUrl?: string | null;
  websiteDomain?: string | null;
  description?: string | null;
  note?: string | null;
  appearanceRate: number | null;
  validSamples: number;
}

export function CompetitorManager({
  brandId,
  competitors,
  brand,
}: {
  brandId: string;
  competitors: CompetitorRow[];
  brand: { name: string; appearanceRate: number | null; validSamples: number };
}) {
  const [rows, setRows] = useState(competitors);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const maxSamples = Math.max(brand.validSamples, ...rows.map((r) => r.validSamples), 0);
  const sampleMismatch = rows.some((r) => r.validSamples !== brand.validSamples);

  async function handleAdd() {
    if (name.trim() === "") {
      toast.error("请填写竞品名称");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, name: name.trim(), websiteUrl, description }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "添加失败");
        return;
      }
      toast.success("竞品已添加，执行搜索后会出现对比数据");
      setRows((prev) => [
        ...prev,
        {
          id: json.data.id,
          name: json.data.name,
          websiteUrl: json.data.websiteUrl,
          websiteDomain: json.data.websiteDomain,
          description: json.data.description,
          note: null,
          appearanceRate: null,
          validSamples: 0,
        },
      ]);
      setOpen(false);
      setName("");
      setWebsiteUrl("");
      setDescription("");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/competitors/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "删除失败");
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== id));
      toast.success("已删除");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>品牌 / 竞品</TableHead>
              <TableHead className="w-40">出现率</TableHead>
              <TableHead className="w-24">有效样本</TableHead>
              <TableHead className="w-44">官网域名</TableHead>
              <TableHead className="w-20">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-primary/5">
              <TableCell className="font-medium">{brand.name}（本品牌）</TableCell>
              <TableCell>{formatPercent(brand.appearanceRate)}</TableCell>
              <TableCell className="font-mono text-xs">{brand.validSamples}</TableCell>
              <TableCell className="font-mono text-[12px] text-tertiary">—</TableCell>
              <TableCell />
            </TableRow>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <p className="py-8 text-center text-[13px] text-muted-foreground">
                    尚未添加竞品。竞品出现率与本品牌使用相同的分母（有效已完成问题）。
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>{r.appearanceRate === null ? "—" : formatPercent(r.appearanceRate)}</TableCell>
                  <TableCell className="font-mono text-xs">{r.validSamples}</TableCell>
                  <TableCell className="font-mono text-[12px] text-tertiary">{r.websiteDomain ?? "—"}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)} disabled={busy} aria-label="删除竞品">
                      <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {sampleMismatch ? (
        <Card>
          <CardContent className="p-4 text-xs text-warning">
            注意：不同品牌条目的有效样本数存在差异（当前最大样本 {maxSamples}），样本量不同的条目之间不建议直接比较提及率。
          </CardContent>
        </Card>
      ) : null}

      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-4 w-4" /> 添加竞品
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加竞品</DialogTitle>
            <DialogDescription>竞品名称、别名与官网域名用于规则识别搜索结果中的竞品提及。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cName">竞品名称</Label>
              <Input id="cName" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cSite">官网（可选）</Label>
              <Input id="cSite" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://competitor.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cDesc">描述（可选）</Label>
              <Textarea id="cDesc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={handleAdd} disabled={busy}>
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
