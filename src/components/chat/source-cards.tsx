"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Copy, Check, Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

export interface RunSource {
  citationIndex: number;
  resultId: string;
  title: string;
  url: string;
  domain: string | null;
  snippet: string | null;
  publishedAt: string | null;
}

export function SourceCards({ sources }: { sources: RunSource[] }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  if (sources.length === 0) return null;
  const visible = expanded ? sources : sources.slice(0, 3);

  async function copyUrl(url: string, index: number) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(index);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("复制失败");
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="mb-2 text-[11px] font-medium text-tertiary">来源（{sources.length}，与回答中的 [编号] 对应）</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {visible.map((s) => (
          <div key={`${s.citationIndex}-${s.resultId}`} className="rounded-lg border border-border bg-surface-subtle p-2.5 transition-colors hover:border-border-strong">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1 text-[12px] font-medium leading-5 text-[color:var(--text-primary)]">
                <Badge variant="secondary" className="mr-1.5 font-mono">[{s.citationIndex}]</Badge>
                {s.title}
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => copyUrl(s.url, s.citationIndex)}
                  aria-label="复制来源链接"
                  title="复制来源链接"
                >
                  {copied === s.citationIndex ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                </Button>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                  aria-label="打开来源网页"
                  title="打开来源网页"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
            <p className="mt-1 truncate font-mono text-[10px] text-quaternary">
              {s.domain ?? new URL(s.url).hostname}
              {s.publishedAt ? ` · ${s.publishedAt}` : ""}
            </p>
            {s.snippet ? <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-tertiary">{s.snippet}</p> : null}
          </div>
        ))}
      </div>
      {sources.length > 3 ? (
        <Button variant="ghost" size="sm" className="mt-1.5 h-7 text-xs" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "收起来源" : `查看全部 ${sources.length} 个来源`}
        </Button>
      ) : null}
    </div>
  );
}

/** 搜索证据模式的结果列表（来自 Run 的真实搜索结果）。 */
export function EvidenceResultList({ sources, runId, conversationId }: { sources: RunSource[]; runId: string; conversationId: string }) {
  const [savedInfo, setSavedInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSaveEvidence() {
    setSaving(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/runs/${runId}/save-evidence`, { method: "POST" });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "保存失败");
        return;
      }
      setSavedInfo(json.data.message);
      toast.success(json.data.message);
    } finally {
      setSaving(false);
    }
  }

  if (sources.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-border bg-surface-subtle p-4 text-center text-[12px] text-tertiary">
        本次搜索没有返回结果。可尝试更换关键词后重新提问。
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={handleSaveEvidence} disabled={saving}>
          <Database className="mr-1 h-3.5 w-3.5" /> {saving ? "确认中…" : "确认保存到证据库"}
        </Button>
        <span className="text-[11px] text-quaternary">
          搜索执行时已按当前用户/工作空间归档；此操作返回真实保存状态。
        </span>
      </div>
      {savedInfo ? <p className="rounded-lg border border-success/25 bg-success-soft px-3 py-2 text-[12px] text-success">{savedInfo}</p> : null}
      <div className="space-y-2">
        {sources.map((s) => (
          <div key={`${s.citationIndex}-${s.resultId}`} className="rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-border-strong">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1 text-[13px] font-medium text-[color:var(--text-primary)]">
                <Badge variant="secondary" className="mr-1.5 font-mono">[{s.citationIndex}]</Badge>
                {s.title}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void navigator.clipboard.writeText(s.url).then(() => toast.success("链接已复制"))} aria-label="复制链接">
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary hover:bg-secondary" >
                  <ExternalLink className="h-3.5 w-3.5" /> 打开
                </a>
              </div>
            </div>
            <p className="mt-1 font-mono text-[11px] text-quaternary">
              {s.domain ?? "—"}
              {s.publishedAt ? ` · 发布：${s.publishedAt}` : ""}
              {` · 采集于会话执行时`}
            </p>
            {s.snippet ? <p className="mt-1.5 text-[12px] leading-relaxed text-tertiary">{s.snippet}</p> : null}
          </div>
        ))}
      </div>
      <p className="text-[10px] leading-relaxed text-quaternary">
        以上为搜索接口实际返回的摘要，不代表已读取网页全文；发布时间为接口真实返回（缺失则不显示）。{formatDate(new Date()) === "" ? "" : ""}
      </p>
    </div>
  );
}
