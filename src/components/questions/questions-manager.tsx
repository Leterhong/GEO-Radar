"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/kpi-card";
import { formatDate } from "@/lib/utils";
import { Copy, Download, History, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";

export interface QuestionSetItem {
  id: string;
  name: string;
  description?: string | null;
  currentVersion?: number;
  latestVersion?: number;
  questionCount?: number;
  taskCount?: number;
}

export interface QuestionItem {
  id: string;
  text: string;
  questionSetId: string;
  questionSetName: string;
  category?: string | null;
  priority: number;
  enabled: boolean;
  version?: number;
  createdAt: string;
}

interface ImportResult {
  created: number;
  skipped: number;
  errors: Array<{ row: number; reason: string; text?: string }>;
}

export function QuestionsManager({
  initialSets,
  initialQuestions,
}: {
  initialSets: QuestionSetItem[];
  initialQuestions: QuestionItem[];
}) {
  const [sets, setSets] = useState(initialSets);
  const [questions, setQuestions] = useState(initialQuestions);
  const [selectedSet, setSelectedSet] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [createSetOpen, setCreateSetOpen] = useState(false);
  const [newSetName, setNewSetName] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newQuestionText, setNewQuestionText] = useState("");
  const [newQuestionCategory, setNewQuestionCategory] = useState("");
  const [newQuestionPriority, setNewQuestionPriority] = useState("3");
  const [addTargetSet, setAddTargetSet] = useState(initialSets[0]?.id ?? "");
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionsSet, setVersionsSet] = useState<QuestionSetItem | null>(null);
  const [versions, setVersions] = useState<
    Array<{ id: string; version: number; note: string | null; questionCount: number; enabledCount: number; createdAt: string; questions: Array<{ id: string; text: string; category: string | null; enabled: boolean }> }>
  >([]);
  const [versionsBusy, setVersionsBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importTargetSet, setImportTargetSet] = useState(initialSets[0]?.id ?? "");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = questions.filter(
    (q) =>
      (selectedSet === "all" || q.questionSetId === selectedSet) &&
      (search === "" || q.text.toLowerCase().includes(search.toLowerCase()))
  );

  async function reload() {
    const res = await fetch("/api/questions?pageSize=100");
    const json = await res.json();
    if (json.ok) {
      setQuestions(json.data.questions);
    }
    const resSets = await fetch("/api/question-sets");
    const jsonSets = await resSets.json();
    if (jsonSets.ok) setSets(jsonSets.data.questionSets);
  }

  async function handleCreateSet() {
    if (newSetName.trim() === "") {
      toast.error("请填写问题集名称");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/question-sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSetName.trim() }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "创建失败");
        return;
      }
      toast.success("问题集已创建");
      setCreateSetOpen(false);
      setNewSetName("");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleAddQuestion() {
    if (newQuestionText.trim() === "") {
      toast.error("请填写问题内容");
      return;
    }
    if (!addTargetSet) {
      toast.error("请先创建问题集");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionSetId: addTargetSet,
          text: newQuestionText.trim(),
          category: newQuestionCategory.trim() || undefined,
          priority: Number(newQuestionPriority) || 3,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "添加失败");
        return;
      }
      toast.success("问题已添加（问题集已生成新版本）");
      setAddOpen(false);
      setNewQuestionText("");
      setNewQuestionCategory("");
      setNewQuestionPriority("3");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleViewVersions(set: QuestionSetItem) {
    setVersionsSet(set);
    setVersionsOpen(true);
    setVersionsBusy(true);
    try {
      const res = await fetch(`/api/question-sets/${set.id}/versions`);
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "版本加载失败");
        return;
      }
      setVersions(json.data.versions);
    } finally {
      setVersionsBusy(false);
    }
  }

  async function handleCopySet(set: QuestionSetItem) {
    setBusy(true);
    try {
      const res = await fetch(`/api/question-sets/${set.id}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `${set.name}（副本）` }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "复制失败");
        return;
      }
      toast.success(`已复制问题集（${json.data.questionCount} 个问题，新版本 v1）`);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteQuestion(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/questions/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "删除失败");
        return;
      }
      setQuestions((prev) => prev.filter((q) => q.id !== id));
      toast.success("已删除");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleEnabled(q: QuestionItem) {
    setBusy(true);
    try {
      const res = await fetch(`/api/questions/${q.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !q.enabled }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "更新失败");
        return;
      }
      setQuestions((prev) => prev.map((item) => (item.id === q.id ? { ...item, enabled: !q.enabled } : item)));
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    if (!importTargetSet) {
      toast.error("请选择目标问题集");
      return;
    }
    const isCsv = importText.includes(",");
    setBusy(true);
    try {
      const res = await fetch("/api/questions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isCsv ? { questionSetId: importTargetSet, csv: importText } : { questionSetId: importTargetSet, text: importText }
        ),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "导入失败");
        return;
      }
      setImportResult(json.data);
      toast.success(`导入完成：新增 ${json.data.created} 条，跳过 ${json.data.skipped} 条`);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512 * 1024) {
      toast.error("文件超过 512KB，请拆分后导入");
      return;
    }
    const text = await file.text();
    setImportText(text);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={selectedSet} onValueChange={setSelectedSet}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="全部问题集" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部问题集</SelectItem>
            {sets.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索问题…" className="pl-8" />
        </div>
        <Button variant="outline" onClick={() => setCreateSetOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> 新建问题集
        </Button>
        <Button onClick={() => setAddOpen(true)} disabled={sets.length === 0}>
          <Plus className="mr-1 h-4 w-4" /> 添加问题
        </Button>
        <Button variant="outline" onClick={() => setImportOpen(true)} disabled={sets.length === 0}>
          <Upload className="mr-1 h-4 w-4" /> 批量导入
        </Button>
        <Button variant="outline" asChild>
          <a href="/api/questions/import" download>
            <Download className="mr-1 h-4 w-4" /> 导出
          </a>
        </Button>
      </div>

      {sets.length > 0 ? (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {sets.map((set) => (
            <div key={set.id} className="min-w-[250px] flex-1 rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{set.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge variant="info" className="text-[10px]">v{set.currentVersion ?? "—"}</Badge>
                    <Badge variant="muted" className="text-[10px]">{set.questionCount ?? 0} 个问题</Badge>
                    <Badge variant="secondary" className="text-[10px]">任务 {set.taskCount ?? 0}</Badge>
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => void handleViewVersions(set)}>
                  <History className="mr-1 h-3.5 w-3.5" /> 版本
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void handleCopySet(set)} disabled={busy}>
                  <Copy className="mr-1 h-3.5 w-3.5" /> 复制
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setSelectedSet(set.id); setAddTargetSet(set.id); setAddOpen(true); }}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> 加问题
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {sets.length === 0 ? (
        <EmptyState
          title="还没有问题集"
          description="先创建一个问题集（如：品牌认知、产品推荐、行业对比），再向其中添加要追踪的搜索问题。"
          action={
            <Button onClick={() => setCreateSetOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> 新建问题集
            </Button>
          }
        />
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">启用</TableHead>
                <TableHead>问题</TableHead>
                <TableHead className="w-28">类别</TableHead>
                <TableHead className="w-32">问题集</TableHead>
                <TableHead className="w-16">优先级</TableHead>
                <TableHead className="w-36">创建时间</TableHead>
                <TableHead className="w-20">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-[13px] text-muted-foreground">
                    没有符合条件的问题
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={q.enabled}
                        onChange={() => handleToggleEnabled(q)}
                        disabled={busy}
                        className="h-4 w-4"
                        aria-label="启用状态"
                      />
                    </TableCell>
                    <TableCell className="max-w-md">
                      <span className="line-clamp-2">{q.text}</span>
                      {q.version ? <span className="ml-1 font-mono text-[10px] text-quaternary">v{q.version}</span> : null}
                    </TableCell>
                    <TableCell className="text-[11px] text-tertiary">{q.category || "未分类"}</TableCell>
                    <TableCell className="text-[12px] text-tertiary">{q.questionSetName}</TableCell>
                    <TableCell>
                      <Badge variant="muted">P{q.priority}</Badge>
                    </TableCell>
                    <TableCell className="text-[12px] text-tertiary">{formatDate(q.createdAt)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteQuestion(q.id)}
                        disabled={busy}
                        aria-label="删除问题"
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 新建问题集 */}
      <Dialog open={createSetOpen} onOpenChange={setCreateSetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建问题集</DialogTitle>
            <DialogDescription>问题集用于组织同一主题下的搜索问题。</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="setName">名称</Label>
            <Input id="setName" value={newSetName} onChange={(e) => setNewSetName(e.target.value)} placeholder="例如：品牌认知" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateSetOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateSet} disabled={busy}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 添加问题 */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加问题</DialogTitle>
            <DialogDescription>问题会保存到所选问题集，可在搜索实验室中执行真实搜索。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>目标问题集</Label>
              <Select value={addTargetSet} onValueChange={setAddTargetSet}>
                <SelectTrigger>
                  <SelectValue placeholder="选择问题集" />
                </SelectTrigger>
                <SelectContent>
                  {sets.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qtext">问题内容</Label>
              <Textarea
                id="qtext"
                value={newQuestionText}
                onChange={(e) => setNewQuestionText(e.target.value)}
                placeholder="例如：有哪些适合中小企业用的 GEO 分析工具？"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="qcategory">问题类别（可选）</Label>
                <Input
                  id="qcategory"
                  list="question-categories"
                  value={newQuestionCategory}
                  onChange={(e) => setNewQuestionCategory(e.target.value)}
                  placeholder="例如：产品对比"
                />
                <datalist id="question-categories">
                  {["品牌认知", "产品功能", "产品对比", "购买决策", "使用教程", "场景解决方案", "行业知识"].map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label>优先级</Label>
                <Select value={newQuestionPriority} onValueChange={setNewQuestionPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((p) => (
                      <SelectItem key={p} value={String(p)}>
                        P{p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              取消
            </Button>
            <Button onClick={handleAddQuestion} disabled={busy}>
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 版本历史 */}
      <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>问题集版本历史 · {versionsSet?.name}</DialogTitle>
            <DialogDescription>
              版本快照不可修改。历史任务引用创建时的版本；编辑当前问题不会改变已完成任务的问题内容。
            </DialogDescription>
          </DialogHeader>
          {versionsBusy ? (
            <p className="py-8 text-center text-[12px] text-tertiary">加载中…</p>
          ) : versions.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-tertiary">暂无版本记录。</p>
          ) : (
            <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {versions.map((version) => (
                <div key={version.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={version.version === versionsSet?.currentVersion ? "success" : "secondary"}>
                      v{version.version}
                      {version.version === versionsSet?.currentVersion ? " · 当前" : ""}
                    </Badge>
                    <span className="text-[11px] text-tertiary">{version.questionCount} 个问题 / {version.enabledCount} 个启用</span>
                    <span className="ml-auto text-[10px] text-quaternary">{formatDate(version.createdAt)}</span>
                  </div>
                  {version.note ? <p className="mt-1 text-[11px] text-tertiary">{version.note}</p> : null}
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] text-primary">查看该版本问题</summary>
                    <ul className="mt-1 space-y-0.5 pl-4 text-[11px] text-secondary-soft">
                      {version.questions.map((q) => (
                        <li key={q.id} className="list-disc">
                          {q.text}
                          {q.category ? <span className="ml-1 text-quaternary">（{q.category}）</span> : null}
                          {!q.enabled ? <span className="ml-1 text-warning">（已停用）</span> : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 批量导入 */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>批量导入问题</DialogTitle>
            <DialogDescription>
              支持每行一个问题的纯文本，或包含 text/问题 列的 CSV 文件。导入前会去重并报告错误行，不会静默跳过。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>目标问题集</Label>
              <Select value={importTargetSet} onValueChange={setImportTargetSet}>
                <SelectTrigger>
                  <SelectValue placeholder="选择问题集" />
                </SelectTrigger>
                <SelectContent>
                  {sets.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="csv">内容</Label>
                <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload className="mr-1 h-3.5 w-3.5" /> 选择 CSV 文件
                </Button>
                <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
              </div>
              <Textarea
                id="csv"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                className="min-h-40 font-mono text-xs"
                placeholder={"text\n有哪些适合中小企业用的 GEO 分析工具？\nGEO 和 SEO 有什么区别？"}
              />
            </div>
            {importResult ? (
              <div className="rounded-md border bg-surface-muted p-3 text-xs">
                <p>
                  导入完成：新增 <span className="font-medium">{importResult.created}</span> 条，跳过{" "}
                  <span className="font-medium">{importResult.skipped}</span> 条。
                </p>
                {importResult.errors.length > 0 ? (
                  <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-muted-foreground">
                    {importResult.errors.slice(0, 20).map((e, i) => (
                      <li key={i}>
                        第 {e.row} 行：{e.reason}
                        {e.text ? `（${e.text.slice(0, 30)}…）` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              关闭
            </Button>
            <Button onClick={handleImport} disabled={busy || importText.trim() === ""}>
              导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
