"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Markdown } from "@/components/chat/markdown";
import { ModeSelector, ModeDescription, MODE_META, type ChatMode } from "@/components/chat/mode-selector";
import { SourceCards, EvidenceResultList, type RunSource } from "@/components/chat/source-cards";
import { cn, formatDate } from "@/lib/utils";
import {
  Plus, Send, Square, Copy, Check, Pencil, RotateCcw, Trash2, Search,
  AlertTriangle, Settings, Radar, Loader2, ListTree, Wrench, ScrollText,
  Star, Paperclip, X,
} from "lucide-react";

interface ConversationRow {
  id: string;
  title: string;
  currentMode: ChatMode;
  isFavorite: boolean;
  updatedAt: string;
  preview: string;
}

interface AttachmentRow {
  id: string;
  filename: string;
  sizeBytes: number;
  parseStatus: "PARSED" | "FAILED" | "UNSUPPORTED";
  parseError: string | null;
  createdAt: string;
}

interface MessageRow {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  mode: ChatMode;
  status: string;
  runId: string | null;
  createdAt: string;
}

interface RunRow {
  id: string;
  userMessageId: string;
  assistantMessageId: string | null;
  mode: ChatMode;
  status: "QUEUED" | "SEARCHING" | "GENERATING" | "COMPLETED" | "FAILED" | "CANCELLED";
  stage: string | null;
  searchTaskId: string | null;
  searchError: string | null;
  modelError: string | null;
  modelProvider: string | null;
  modelName: string | null;
  errorCode: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  startedAt: string;
  finishedAt: string | null;
}

interface RunDetail {
  run: RunRow;
  sources: RunSource[];
  evidenceCount: number;
}

const STAGE_TEXT: Record<string, string> = {
  queued: "已创建执行记录…",
  searching: "正在搜索网页…",
  analyzing_saved_data: "正在分析已保存的数据…",
  generating: "正在生成回答…",
  completed: "完成",
  completed_no_model: "完成（未调用模型）",
  completed_rule_analysis: "完成（规则分析）",
  completed_insufficient_data: "完成（数据不足）",
  search_failed: "搜索失败",
  model_failed: "模型调用失败",
  cancelled: "已停止",
  failed: "失败",
};

export function ChatWorkspace({
  brands,
  searchConfigured,
  modelConfigured,
  initialConversations,
}: {
  brands: Array<{ id: string; name: string }>;
  searchConfigured: boolean;
  modelConfigured: boolean;
  initialConversations: ConversationRow[];
}) {
  const router = useRouter();
  const [conversations, setConversations] = useState(initialConversations);
  const [conversationSearch, setConversationSearch] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<ChatMode>("SEARCH_ANSWER");
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [sourcesByRun, setSourcesByRun] = useState<Record<string, RunSource[]>>({});
  const [input, setInput] = useState("");
  const [brandId, setBrandId] = useState<string>("none");
  const [submitting, setSubmitting] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [editingMessage, setEditingMessage] = useState<{ id: string; content: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<ConversationRow | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ConversationRow | null>(null);
  const [confirmNoModel, setConfirmNoModel] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState<string | null>(null);
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [optimizationDialog, setOptimizationDialog] = useState<{ title: string; description: string } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const stickToBottom = useRef(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const filteredConversations = conversations.filter((c) => {
    if (favoriteOnly && !c.isFavorite) return false;
    return conversationSearch === "" ? true : c.title.toLowerCase().includes(conversationSearch.toLowerCase());
  });

  const refreshConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    const json = await res.json();
    if (json.ok) setConversations(json.data.conversations);
  }, []);

  async function toggleFavorite(conversation: ConversationRow) {
    const next = !conversation.isFavorite;
    setConversations((prev) => prev.map((c) => (c.id === conversation.id ? { ...c, isFavorite: next } : c)));
    const res = await fetch(`/api/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFavorite: next }),
    });
    const json = await res.json();
    if (!json.ok) {
      setConversations((prev) => prev.map((c) => (c.id === conversation.id ? { ...c, isFavorite: !next } : c)));
      toast.error(json?.error?.message ?? "操作失败");
      return;
    }
    toast.success(next ? "已收藏" : "已取消收藏");
  }

  const loadAttachments = useCallback(async (conversationId: string) => {
    const res = await fetch(`/api/conversations/${conversationId}/attachments`);
    const json = await res.json();
    if (json.ok) setAttachments(json.data.attachments);
  }, []);

  async function handleUpload(file: File) {
    if (!activeId) return toast.error("请先新建或选择对话");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/conversations/${activeId}/attachments`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "上传失败");
        await loadAttachments(activeId);
        return;
      }
      toast.success(`已解析「${json.data.filename}」（${json.data.chars} 字）`);
      await loadAttachments(activeId);
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoveAttachment(attachmentId: string) {
    if (!activeId) return;
    const res = await fetch(`/api/conversations/${activeId}/attachments?attachmentId=${attachmentId}`, { method: "DELETE" });
    const json = await res.json();
    if (!json.ok) {
      toast.error(json?.error?.message ?? "删除失败");
      return;
    }
    setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  }

  const loadConversation = useCallback(async (conversationId: string) => {
    setLoadingConversation(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`);
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "加载会话失败");
        return;
      }
      setActiveId(conversationId);
      setTitle(json.data.conversation.title);
      setMode(json.data.conversation.currentMode);
      setMessages(json.data.messages);
      setRuns(json.data.runs);
      setSourcesByRun({});
      setActiveRunId(null);
      setActiveStage(null);
      void loadAttachments(conversationId);
      window.localStorage.setItem("georadar_chat_active", conversationId);
    } finally {
      setLoadingConversation(false);
    }
  }, [loadAttachments]);

  useEffect(() => {
    const saved = window.localStorage.getItem("georadar_chat_active");
    if (saved && conversations.some((c) => c.id === saved)) {
      void loadConversation(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 滚动：仅当用户位于底部附近时自动跟随
  const scrollToBottom = useCallback((force = false) => {
    const el = scrollRef.current;
    if (!el) return;
    if (force || stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, activeStage, scrollToBottom]);

  const pollRun = useCallback(
    (conversationId: string, runId: string) => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        const res = await fetch(`/api/conversations/${conversationId}/runs/${runId}`);
        const json = await res.json();
        if (!json.ok) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setActiveRunId(null);
          return;
        }
        const detail: RunDetail = json.data;
        setActiveStage(detail.run.stage);
        setSourcesByRun((prev) => ({ ...prev, [runId]: detail.sources }));
        if (["COMPLETED", "FAILED", "CANCELLED"].includes(detail.run.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setActiveRunId(null);
          setActiveStage(null);
          await loadConversation(conversationId);
          setSourcesByRun((prev) => ({ ...prev, [runId]: detail.sources }));
          if (detail.run.status === "FAILED" && detail.run.modelError) {
            toast.warning(`模型阶段失败：${detail.run.modelError}（搜索结果已保留）`);
          } else if (detail.run.status === "FAILED") {
            toast.error(detail.run.searchError?.replace(/^\[[^\]]+\]\s*/, "") ?? "执行失败");
          }
        }
      }, 1500);
    },
    [loadConversation]
  );

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleSend(searchOnly = false) {
    const content = input.trim();
    if (content === "" || submitting) return;
    if (content.length > 500) {
      toast.error("消息过长（最多 500 字符）");
      return;
    }
    if (!activeId) {
      toast.error("请先新建对话");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/conversations/${activeId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, content, brandId: brandId === "none" ? "" : brandId, searchOnly }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "发送失败");
        return;
      }
      setInput("");
      setEditingMessage(null);
      const runId = json.data.runId;
      setMessages((prev) => [
        ...prev,
        {
          id: json.data.userMessageId,
          role: "USER",
          content,
          mode,
          status: "COMPLETED",
          runId,
          createdAt: new Date().toISOString(),
        },
      ]);
      setActiveRunId(runId);
      setActiveStage("queued");
      stickToBottom.current = true;
      scrollToBottom(true);
      pollRun(activeId, runId);
      void refreshConversations();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNewConversation() {
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    const json = await res.json();
    if (!json.ok) {
      toast.error(json?.error?.message ?? "创建失败");
      return;
    }
    await refreshConversations();
    setActiveId(json.data.id);
    setTitle(json.data.title);
    setMessages([]);
    setRuns([]);
    setSourcesByRun({});
    setInput("");
    window.localStorage.setItem("georadar_chat_active", json.data.id);
  }

  async function handleCancel() {
    if (!activeId || !activeRunId) return;
    await fetch(`/api/conversations/${activeId}/runs/${activeRunId}/cancel`, { method: "POST" });
    toast.info("已请求停止：当前阶段完成后将标记为已停止。");
  }

  async function handleRetry(runId: string) {
    if (!activeId) return;
    const res = await fetch(`/api/conversations/${activeId}/runs/${runId}/retry`, { method: "POST" });
    const json = await res.json();
    if (!json.ok) {
      toast.error(json?.error?.message ?? "重试失败");
      return;
    }
    setActiveRunId(json.data.runId);
    setActiveStage("queued");
    stickToBottom.current = true;
    scrollToBottom(true);
    pollRun(activeId, json.data.runId);
  }

  async function handleRename() {
    if (!renameTarget || renameValue.trim() === "") return;
    const res = await fetch(`/api/conversations/${renameTarget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: renameValue.trim() }),
    });
    const json = await res.json();
    if (!json.ok) {
      toast.error(json?.error?.message ?? "重命名失败");
      return;
    }
    setConversations((prev) => prev.map((c) => (c.id === renameTarget.id ? { ...c, title: renameValue.trim() } : c)));
    if (renameTarget.id === activeId) setTitle(renameValue.trim());
    setRenameTarget(null);
    toast.success("已重命名");
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/conversations/${deleteTarget.id}`, { method: "DELETE" });
    const json = await res.json();
    if (!json.ok) {
      toast.error(json?.error?.message ?? "删除失败");
      return;
    }
    setConversations((prev) => prev.filter((c) => c.id !== deleteTarget.id));
    if (deleteTarget.id === activeId) {
      setActiveId(null);
      setMessages([]);
      setRuns([]);
      window.localStorage.removeItem("georadar_chat_active");
    }
    setDeleteTarget(null);
    toast.success("会话已删除（已保存的搜索证据不受影响）");
  }

  async function handleModeChange(next: ChatMode) {
    setMode(next);
    if (!activeId) return;
    await fetch(`/api/conversations/${activeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentMode: next }),
    });
    void refreshConversations();
  }

  async function handleCreateOptimizationTask() {
    if (!optimizationDialog || !brandId || brandId === "none") {
      // 无品牌上下文也可创建，但不关联品牌
    }
    const res = await fetch("/api/recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: optimizationDialog?.title || "来自对话的优化任务",
        description: optimizationDialog?.description || "",
        type: "MANUAL",
        priority: "MEDIUM",
        brandId: brandId !== "none" ? brandId : "",
      }),
    });
    const json = await res.json();
    if (!json.ok) {
      toast.error(json?.error?.message ?? "创建失败");
      return;
    }
    toast.success("优化任务已创建，可在「GEO 优化任务」页查看");
    setOptimizationDialog(null);
  }

  const needsSearch = mode === "SEARCH_ANSWER" || mode === "SEARCH_EVIDENCE";
  const searchBlocked = needsSearch && !searchConfigured;
  const running = activeRunId !== null;
  const activeRun = runs.find((r) => r.id === activeRunId);
  const runsByUserMessage = new Map(runs.map((r) => [r.userMessageId, r]));
  const assistantRunByAssistantMessage = new Map(runs.filter((r) => r.assistantMessageId).map((r) => [r.assistantMessageId as string, r]));

  function messageActionsForUser(m: MessageRow) {
    return (
      <div className="mt-1 flex items-center justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100">
        <button
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-tertiary transition-colors hover:bg-surface-muted hover:text-secondary-soft"
          onClick={() => {
            setEditingMessage({ id: m.id, content: m.content });
            setInput(m.content);
          }}
        >
          <Pencil className="h-3 w-3" /> 编辑
        </button>
        <button
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-tertiary transition-colors hover:bg-surface-muted hover:text-secondary-soft"
          onClick={() => void navigator.clipboard.writeText(m.content).then(() => toast.success("已复制"))}
        >
          <Copy className="h-3 w-3" /> 复制
        </button>
        <button
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-tertiary transition-colors hover:bg-destructive/10 hover:text-destructive"
          onClick={() => void handleDeleteMessage(m.id)}
        >
          <Trash2 className="h-3 w-3" /> 删除
        </button>
      </div>
    );
  }

  async function handleDeleteMessage(messageId: string) {
    if (!activeId) return;
    const res = await fetch(`/api/conversations/${activeId}/messages/${messageId}`, { method: "DELETE" });
    const json = await res.json();
    if (!json.ok) {
      toast.error(json?.error?.message ?? "删除失败");
      return;
    }
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    toast.success("消息已删除（执行记录与证据仍保留）");
  }

  function assistantActions(m: MessageRow) {
    const run = assistantRunByAssistantMessage.get(m.id);
    const sources = run ? sourcesByRun[run.id] ?? [] : [];
    return (
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px]"
          onClick={() => {
            void navigator.clipboard.writeText(m.content);
            setCopiedMessage(m.id);
            setTimeout(() => setCopiedMessage(null), 1500);
          }}
        >
          {copiedMessage === m.id ? <Check className="mr-1 h-3 w-3 text-success" /> : <Copy className="mr-1 h-3 w-3" />}
          复制回答
        </Button>
        {run ? (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => void handleRetry(run.id)} disabled={running}>
            <RotateCcw className="mr-1 h-3 w-3" /> 重新生成
          </Button>
        ) : null}
        {run && run.searchTaskId ? (
          <a
            href={`/search-lab/${run.searchTaskId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center rounded-md px-2 text-[11px] text-secondary-soft transition-colors hover:bg-surface-muted"
          >
            <ScrollText className="mr-1 h-3 w-3" /> 查看执行详情
          </a>
        ) : null}
        {run?.mode === "GEO_ANALYSIS" ? (
          <>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setMethodologyOpen(true)}>
              <ListTree className="mr-1 h-3 w-3" /> 统计口径
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() =>
                setOptimizationDialog({
                  title: `优化任务：${title}`.slice(0, 60),
                  description: m.content.slice(0, 800),
                })
              }
            >
              <Wrench className="mr-1 h-3 w-3" /> 创建优化任务
            </Button>
          </>
        ) : null}
        {run?.mode === "SEARCH_EVIDENCE" && run.searchTaskId ? (
          <span className="text-[10px] text-muted-foreground">结果已按当前用户/工作空间归档至证据库</span>
        ) : null}
        {sources.length > 0 ? null : null}
      </div>
    );
  }

  function renderRunStatus(m: MessageRow) {
    const run = runsByUserMessage.get(m.id);
    if (!run) return null;
    const isTerminal = ["COMPLETED", "FAILED", "CANCELLED"].includes(run.status);
    if (isTerminal) {
      if (run.status === "FAILED") {
        return (
          <div className="mt-2 space-y-2">
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <p className="font-medium">
                  {run.stage === "search_failed" ? "搜索失败" : "模型调用失败"}
                </p>
                <p className="mt-0.5 opacity-90">{run.searchError ?? run.modelError ?? "执行失败"}</p>
                {run.stage === "model_failed" && run.searchTaskId ? (
                  <p className="mt-1 opacity-90">本次搜索结果已保留，可查看下方来源或到证据库查看。</p>
                ) : null}
              </div>
            </div>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void handleRetry(run.id)} disabled={running}>
              <RotateCcw className="mr-1 h-3 w-3" /> 重试
            </Button>
          </div>
        );
      }
      if (run.status === "CANCELLED") {
        return (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-surface-subtle px-3 py-2.5 text-[12px] text-tertiary">
            已停止（停止请求已处理，底层阶段在完成后安全终止）。
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => void handleRetry(run.id)}>
              重新执行
            </Button>
          </div>
        );
      }
      return null;
    }
    // 进行中：显示真实阶段
    const stageText = STAGE_TEXT[run.stage ?? "queued"] ?? "执行中…";
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-border-strong bg-primary-soft px-3 py-2.5 text-[12px] text-primary-strong">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {stageText}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* 会话侧栏 */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card md:flex">
        <div className="p-3">
          <Button className="w-full" onClick={handleNewConversation}>
            <Plus className="mr-1 h-4 w-4" /> 新建对话
          </Button>
        </div>
        <div className="space-y-1.5 px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={conversationSearch}
              onChange={(e) => setConversationSearch(e.target.value)}
              placeholder="搜索历史对话"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <button
            type="button"
            onClick={() => setFavoriteOnly((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
              favoriteOnly ? "bg-primary-soft text-primary-strong" : "text-tertiary hover:bg-surface-muted"
            }`}
          >
            <Star className={`h-3 w-3 ${favoriteOnly ? "fill-current" : ""}`} />
            仅看收藏
          </button>
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3 scrollbar-thin">
          {filteredConversations.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {conversationSearch ? "没有匹配的对话" : "暂无历史对话"}
            </p>
          ) : (
            filteredConversations.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
                  c.id === activeId ? "bg-primary-soft" : "hover:bg-surface-muted"
                )}
                onClick={() => void loadConversation(c.id)}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium" title={c.title}>
                    {c.title}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {MODE_META[c.currentMode]?.label} · {formatDate(c.updatedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    className="rounded p-1 hover:bg-background"
                    aria-label={c.isFavorite ? "取消收藏" : "收藏对话"}
                    title={c.isFavorite ? "取消收藏" : "收藏对话"}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleFavorite(c);
                    }}
                  >
                    <Star className={c.isFavorite ? "h-3 w-3 fill-current text-brand-sand" : "h-3 w-3"} />
                  </button>
                  <button
                    className="rounded p-1 hover:bg-background"
                    aria-label="重命名对话"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenameTarget(c);
                      setRenameValue(c.title);
                    }}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    className="rounded p-1 hover:bg-background"
                    aria-label="删除对话"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(c);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="border-t p-3">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>数据源</span>
            <Badge variant={searchConfigured ? "success" : "muted"}>元宝{searchConfigured ? "已连接" : "未连接"}</Badge>
            <Badge variant={modelConfigured ? "success" : "muted"}>模型{modelConfigured ? "已配置" : "未配置"}</Badge>
          </div>
          <Button variant="ghost" size="sm" className="mt-2 w-full justify-start text-xs" onClick={() => router.push("/settings")}>
            <Settings className="mr-1 h-3.5 w-3.5" /> 设置
          </Button>
        </div>
      </aside>

      {/* 主聊天区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card/70 px-5 backdrop-blur-sm">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{activeId ? title : "新对话"}</p>
            <p className="text-[10px] text-muted-foreground">{MODE_META[mode].label} · {MODE_META[mode].en}</p>
          </div>
          <Button variant="outline" size="sm" className="md:hidden" onClick={handleNewConversation}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto scrollbar-thin"
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className="mx-auto max-w-3xl px-4 py-6">
            {loadingConversation ? (
              <p className="py-20 text-center text-sm text-muted-foreground">加载中…</p>
            ) : messages.length === 0 ? (
              <WelcomeScreen
                onPick={(m, text) => {
                  setMode(m);
                  setInput(text);
                }}
                brandName={brandId !== "none" ? brands.find((b) => b.id === brandId)?.name : undefined}
              />
            ) : (
              <div className="space-y-5">
                {messages.map((m) =>
                  m.role === "USER" ? (
                    <div key={m.id} className="group flex flex-col items-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-md border border-border-strong bg-primary-soft px-4 py-2.5">
                        <p className="whitespace-pre-wrap text-sm">{m.content}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="muted" className="mt-1 text-[9px]">
                          {MODE_META[m.mode]?.label ?? m.mode}
                        </Badge>
                        {messageActionsForUser(m)}
                      </div>
                      {editingMessage?.id === m.id ? (
                        <p className="mt-1 text-[10px] text-warning">
                          已填入编辑内容：修改后点击发送即以新消息重新执行（原消息保留）。
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div key={m.id} className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <Radar className="h-4 w-4 text-primary" />
                        <span className="text-xs font-medium">GEO Radar</span>
                        <Badge variant="muted" className="text-[9px]">{MODE_META[m.mode]?.label}</Badge>
                      </div>
                      <div className="mt-2 rounded-xl border border-border bg-card px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.03)]">
                        <Markdown content={m.content} />
                        {(() => {
                          const run = assistantRunByAssistantMessage.get(m.id);
                          const sources = run ? sourcesByRun[run.id] ?? [] : [];
                          if (sources.length === 0) return null;
                          if (run?.mode === "SEARCH_EVIDENCE" && activeId) {
                            return <EvidenceResultList sources={sources} runId={run.id} conversationId={activeId} />;
                          }
                          return <SourceCards sources={sources} />;
                        })()}
                        {assistantActions(m)}
                      </div>
                    </div>
                  )
                )}
                {/* 运行中的占位（尚未产生助手消息） */}
                {running && !activeRun?.assistantMessageId ? (
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <Radar className="h-4 w-4 text-primary" />
                      <span className="text-xs font-medium">GEO Radar</span>
                    </div>
                    <div className="mt-2 rounded-xl border border-border bg-card px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.03)]">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        {STAGE_TEXT[activeStage ?? "queued"] ?? "执行中…"}
                      </div>
                      {activeRun?.stage === "model_failed" ? null : null}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {/* 输入区 */}
        <div className="shrink-0 border-t border-border bg-card/60 px-4 py-3">
          <div className="mx-auto max-w-3xl space-y-2">
            <ModeSelector value={mode} onChange={handleModeChange} disabled={running} />
            <ModeDescription mode={mode} />
            {searchBlocked || (!modelConfigured && mode === "SEARCH_ANSWER") ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-warning/25 bg-warning-soft px-3 py-2 text-[11.5px] leading-relaxed text-warning">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {searchBlocked ? "当前模式需要元宝搜索，数据源尚未连接。" : ""}
                  {!modelConfigured && mode === "SEARCH_ANSWER"
                    ? "未配置大模型，无法生成综合回答（可发送后选择仅查看搜索结果）。"
                    : ""}
                </span>
                <a href="/settings" className="font-medium underline underline-offset-2">
                  前往设置 →
                </a>
              </div>
            ) : null}
            {attachments.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {attachments.map((attachment) => (
                  <span
                    key={attachment.id}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${
                      attachment.parseStatus === "PARSED"
                        ? "border-border bg-surface-subtle text-secondary-soft"
                        : "border-warning/25 bg-warning-soft text-warning"
                    }`}
                    title={attachment.parseError ?? attachment.filename}
                  >
                    <Paperclip className="h-3 w-3" />
                    {attachment.filename}
                    <span className="text-quaternary">
                      {attachment.parseStatus === "PARSED" ? `${Math.round(attachment.sizeBytes / 1024)}KB` : "未解析"}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleRemoveAttachment(attachment.id)}
                      aria-label={`移除附件 ${attachment.filename}`}
                      className="rounded p-0.5 hover:bg-card"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <input
                ref={attachmentInputRef}
                type="file"
                accept=".txt,.md,.markdown,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUpload(file);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-[44px] w-[44px] shrink-0"
                onClick={() => attachmentInputRef.current?.click()}
                disabled={uploading || running || !activeId}
                aria-label="上传附件（TXT / Markdown / CSV）"
                title="上传附件（TXT / Markdown / CSV）"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              </Button>
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (running) return;
                    if (!modelConfigured && mode === "SEARCH_ANSWER" && input.trim() !== "" && needsSearch) {
                      setConfirmNoModel(true);
                      return;
                    }
                    void handleSend(false);
                  }
                }}
                placeholder={`输入问题（${MODE_META[mode].label}）… Enter 发送，Shift+Enter 换行`}
                className="max-h-40 min-h-[44px] resize-none"
                rows={1}
                disabled={running}
                maxLength={500}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                }}
              />
              {running ? (
                <Button variant="destructive" onClick={handleCancel} className="h-[44px] shrink-0 px-3">
                  <Square className="mr-1 h-4 w-4" /> 停止
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    if (!modelConfigured && mode === "SEARCH_ANSWER") {
                      setConfirmNoModel(true);
                      return;
                    }
                    void handleSend(false);
                  }}
                  disabled={input.trim() === "" || submitting}
                  className="h-[44px] shrink-0 px-4"
                >
                  <Send className="mr-1 h-4 w-4" /> 发送
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Select value={brandId} onValueChange={setBrandId}>
                <SelectTrigger className="h-7 w-40 text-[11px]">
                  <SelectValue placeholder="品牌上下文（可选）" />
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
              <span className="text-[10px] text-muted-foreground">{input.length}/500</span>
            </div>
          </div>
        </div>
      </div>

      {/* 未配置模型的知情选择 */}
      <Dialog open={confirmNoModel} onOpenChange={setConfirmNoModel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>未配置大模型</DialogTitle>
            <DialogDescription>
              「搜索问答」需要元宝搜索与大模型两项服务。当前未配置大模型，无法生成综合回答——系统不会伪造 AI 回答。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => router.push("/settings")}>
              去配置模型
            </Button>
            <Button
              onClick={() => {
                setConfirmNoModel(false);
                void handleSend(true);
              }}
              disabled={submitting}
            >
              仅查看搜索结果（不生成回答）
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重命名 */}
      <Dialog open={renameTarget !== null} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>重命名对话</DialogTitle>
          </DialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={100} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>取消</Button>
            <Button onClick={handleRename}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>删除对话</DialogTitle>
            <DialogDescription>
              将删除「{deleteTarget?.title}」的会话、消息与执行记录；已保存到证据库的搜索证据与任务记录不受影响。此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={handleDelete}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 统计口径 */}
      <Dialog open={methodologyOpen} onOpenChange={setMethodologyOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>GEO 指标统计口径</DialogTitle>
            <DialogDescription>所有 GEO 分析均由业务代码基于真实数据计算，模型仅负责解读。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-xs text-muted-foreground">
            <p>品牌出现率 = 至少一条有效结果被确认包含本品牌的已完成问题数 ÷ 有效已完成问题总数 × 100%。</p>
            <p>问题覆盖率 = 存在至少一条有效结果的问题数 ÷ 有效已完成问题总数 × 100%。</p>
            <p>官网来源覆盖率 = 至少一条结果来自品牌官网域名（同站判定）的问题数 ÷ 有效已完成问题总数 × 100%。</p>
            <p>分母口径：真实模式（source=LAB）、状态成功的问题，按问题去重取最近一次成功执行；失败、取消与未执行的问题不计入分母，单独统计。对话模式的搜索不进入 GEO 指标。</p>
            <p>「未检测到」仅表示本次样本中未出现，不代表品牌在全网或 AI 生态中无曝光。样本不足时显示「样本不足」，不伪造数字。</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* 创建优化任务 */}
      <Dialog open={optimizationDialog !== null} onOpenChange={(open) => !open && setOptimizationDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建 GEO 优化任务</DialogTitle>
            <DialogDescription>预填了分析内容，可修改后保存到「GEO 优化任务」。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">标题</label>
              <Input
                value={optimizationDialog?.title ?? ""}
                onChange={(e) => setOptimizationDialog((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                maxLength={150}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">描述</label>
              <Textarea
                value={optimizationDialog?.description ?? ""}
                onChange={(e) => setOptimizationDialog((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
                className="min-h-28"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOptimizationDialog(null)}>取消</Button>
            <Button onClick={handleCreateOptimizationTask}>创建任务</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WelcomeScreen({ onPick, brandName }: { onPick: (mode: ChatMode, text: string) => void; brandName?: string }) {
  const groups: Array<{ mode: ChatMode; examples: string[] }> = [
    {
      mode: "SEARCH_ANSWER",
      examples: ["中小企业如何选择合适的项目管理软件？", "比较几种常见的客户关系管理工具。"],
    },
    {
      mode: "SEARCH_EVIDENCE",
      examples: ["查找关于企业 GEO 优化的公开资料。", "搜索哪些公开来源讨论品牌在 AI 搜索中的曝光。"],
    },
    {
      mode: "GEO_ANALYSIS",
      examples: [
        brandName ? `分析「${brandName}」品牌证据中最常出现的外部域名。` : "分析当前品牌证据中最常出现的外部域名。",
        "找出当前问题集中品牌未被提及的有效样本。",
      ],
    },
  ];
  return (
    <div className="flex flex-col items-center rounded-2xl border border-border/70 bg-gradient-a px-6 py-9 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border-strong bg-card shadow-soft">
        <Radar className="h-5 w-5 text-primary" />
      </span>
      <h2 className="mt-4 text-[19px] font-semibold tracking-tight text-[color:var(--text-primary)]">让每一次搜索，都成为可验证的洞察。</h2>
      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-secondary-soft">
        提出问题，获取真实搜索来源，或分析你的品牌在搜索结果中的表现。
      </p>
      <div className="mt-8 w-full space-y-5 text-left">
        {groups.map((group) => {
          const meta = MODE_META[group.mode];
          return (
            <div key={group.mode}>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <meta.icon className="h-3.5 w-3.5" />
                {meta.label}（{meta.en}）示例
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {group.examples.map((example) => (
                  <button
                    key={example}
                    onClick={() => onPick(group.mode, example)}
                    className="rounded-xl border border-border bg-card px-3.5 py-2.5 text-left text-[12px] leading-relaxed text-secondary-soft transition-all duration-150 hover:border-border-strong hover:bg-primary-soft/50 hover:text-[color:var(--text-primary)]"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-6 max-w-md text-[10px] text-muted-foreground">
        示例仅用于填充输入框；搜索与模型调用只会在你发送消息后发生，且需要先完成对应配置。
      </p>
    </div>
  );
}
