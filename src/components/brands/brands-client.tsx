"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils";
import { Plus, Pencil, Trash2 } from "lucide-react";

interface BrandRow {
  id: string;
  name: string;
  websiteUrl?: string | null;
  websiteDomain?: string | null;
  aliases: string[];
  keywords: string[];
  officialSubdomains?: string[];
  products?: string[];
  productAliases?: string[];
  industry?: string | null;
  description?: string | null;
  competitorCount: number;
  createdAt: string;
}

export function BrandsClient({ brands }: { brands: BrandRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(brands);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BrandRow | null>(null);
  const [name, setName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [aliases, setAliases] = useState("");
  const [keywords, setKeywords] = useState("");
  const [officialSubdomains, setOfficialSubdomains] = useState("");
  const [products, setProducts] = useState("");
  const [productAliases, setProductAliases] = useState("");
  const [industry, setIndustry] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  function openCreate() {
    setEditing(null);
    setName("");
    setWebsiteUrl("");
    setAliases("");
    setKeywords("");
    setOfficialSubdomains("");
    setProducts("");
    setProductAliases("");
    setIndustry("");
    setDescription("");
    setOpen(true);
  }

  function openEdit(brand: BrandRow) {
    setEditing(brand);
    setName(brand.name);
    setWebsiteUrl(brand.websiteUrl ?? "");
    setAliases(brand.aliases.join("、"));
    setKeywords(brand.keywords.join("、"));
    setOfficialSubdomains((brand.officialSubdomains ?? []).join("、"));
    setProducts((brand.products ?? []).join("、"));
    setProductAliases((brand.productAliases ?? []).join("、"));
    setIndustry(brand.industry ?? "");
    setDescription(brand.description ?? "");
    setOpen(true);
  }

  async function handleSubmit() {
    if (name.trim() === "") {
      toast.error("请填写品牌名称");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        websiteUrl: websiteUrl.trim(),
        aliases: aliases.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 20),
        keywords: keywords.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 30),
        officialSubdomains: officialSubdomains.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 20),
        products: products.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 30),
        productAliases: productAliases.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 30),
        industry: industry.trim(),
        description: description.trim(),
      };
      const res = editing
        ? await fetch(`/api/brands/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/brands", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "保存失败");
        return;
      }
      toast.success(editing ? "品牌已更新" : "品牌已创建");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/brands/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "删除失败");
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== id));
      toast.success("品牌已删除（历史任务与证据保留）");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button onClick={openCreate}>
        <Plus className="mr-1 h-4 w-4" /> 新建品牌
      </Button>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-14 text-center">
          <p className="text-sm font-medium">还没有品牌档案</p>
          <p className="mt-1.5 text-[13px] text-muted-foreground">创建品牌后才能关联搜索任务、计算可见度指标。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((b) => (
            <Card key={b.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{b.name}</p>
                    <p className="mt-0.5 truncate font-mono text-[12px] text-tertiary">
                      {b.websiteDomain ?? "未配置官网"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(b)} aria-label="编辑品牌">
                      <Pencil className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(b.id)} disabled={busy} aria-label="删除品牌">
                      <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </div>
                </div>
                {b.description ? <p className="mt-2 line-clamp-2 text-[12px] text-tertiary">{b.description}</p> : null}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {b.aliases.slice(0, 3).map((a) => (
                    <Badge key={a} variant="secondary">
                      {a}
                    </Badge>
                  ))}
                  {(b.officialSubdomains ?? []).length > 0 ? (
                    <Badge variant="success">官方子域 {(b.officialSubdomains ?? []).length}</Badge>
                  ) : null}
                  {(b.products ?? []).length > 0 ? <Badge variant="info">产品 {(b.products ?? []).length}</Badge> : null}
                  <Badge variant="muted">竞品 {b.competitorCount}</Badge>
                </div>
                <p className="mt-3 text-[12px] text-tertiary">创建于 {formatDate(b.createdAt)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑品牌" : "新建品牌"}</DialogTitle>
            <DialogDescription>
              官网域名用于官网来源覆盖率与页面归属；名称、别名、产品名用于可解释的文本匹配。修改配置后可对历史任务执行「用当前规则重算」，不会覆盖原始结果。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bName">品牌名称</Label>
              <Input id="bName" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bSite">官网地址</Label>
              <Input id="bSite" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://example.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bSubdomains">官方子域名（可选，用逗号或顿号分隔）</Label>
              <Input
                id="bSubdomains"
                value={officialSubdomains}
                onChange={(e) => setOfficialSubdomains(e.target.value)}
                placeholder="例如：docs.example.com、help.example.com"
              />
              <p className="text-[10px] text-quaternary">用于判定官网页面；不同主域的官方站点也可加入。</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bAlias">品牌别名（用逗号或顿号分隔）</Label>
              <Input id="bAlias" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="例如：XX科技、XX" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bProducts">产品名称（可选）</Label>
                <Input id="bProducts" value={products} onChange={(e) => setProducts(e.target.value)} placeholder="例如：XX 搜索" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bProductAliases">产品别名（可选）</Label>
                <Input id="bProductAliases" value={productAliases} onChange={(e) => setProductAliases(e.target.value)} placeholder="产品简称" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bKeywords">产品/服务关键词（可选，仅用于分析分组）</Label>
              <Input id="bKeywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bIndustry">行业（可选）</Label>
              <Input id="bIndustry" value={industry} onChange={(e) => setIndustry(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bDesc">品牌描述（可选）</Label>
              <Textarea id="bDesc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={busy}>
              {editing ? "保存修改" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
