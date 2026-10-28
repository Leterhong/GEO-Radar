"use client";

import { cn } from "@/lib/utils";
import { Search, Files, ChartNoAxesCombined } from "lucide-react";

export type ChatMode = "SEARCH_ANSWER" | "SEARCH_EVIDENCE" | "GEO_ANALYSIS";

export const MODE_META: Record<ChatMode, { label: string; en: string; description: string; icon: typeof Search }> = {
  SEARCH_ANSWER: {
    label: "搜索问答",
    en: "Search & Answer",
    description: "搜索真实网页，结合来源信息回答你的问题。",
    icon: Search,
  },
  SEARCH_EVIDENCE: {
    label: "搜索证据",
    en: "Search Evidence",
    description: "查看真实网页结果、来源链接和证据，不自动生成长篇回答。",
    icon: Files,
  },
  GEO_ANALYSIS: {
    label: "GEO 分析",
    en: "GEO Analysis",
    description: "分析品牌提及、官网来源、竞品表现和 GEO 内容优化机会。",
    icon: ChartNoAxesCombined,
  },
};

export function ModeSelector({
  value,
  onChange,
  disabled,
  compact = false,
}: {
  value: ChatMode;
  onChange: (mode: ChatMode) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const modes = Object.entries(MODE_META) as Array<[ChatMode, (typeof MODE_META)[ChatMode]]>;
  return (
    <div
      role="tablist"
      aria-label="对话工作模式"
      className="flex items-center gap-1 rounded-xl border border-border bg-surface-muted p-1"
    >
      {modes.map(([mode, meta]) => {
        const active = mode === value;
        return (
          <button
            key={mode}
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(mode)}
            title={meta.description}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-card text-primary-strong shadow-[0_1px_2px_rgba(16,24,40,0.06)]"
                : "text-tertiary hover:bg-card/70 hover:text-secondary-soft",
              disabled && "opacity-50"
            )}
          >
            <meta.icon className={cn("h-3.5 w-3.5 shrink-0", active && "text-primary")} />
            <span>{meta.label}</span>
            {!compact ? <span className="hidden lg:inline text-[10px] text-muted-foreground">{meta.en}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function ModeDescription({ mode }: { mode: ChatMode }) {
  const meta = MODE_META[mode];
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-tertiary">
      <meta.icon className="h-3 w-3" />
      {meta.description}
    </p>
  );
}
