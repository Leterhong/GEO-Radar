"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  FlaskConical,
  ListChecks,
  Eye,
  Swords,
  FolderOpen,
  Wrench,
  GitCompareArrows,
  Monitor,
  Settings,
  Radar,
  Building2,
  MessageCircle,
  BarChart3,
  FileText,
  Activity,
  Grid3X3,
  History,
  CalendarClock,
} from "lucide-react";

const NAV_GROUPS = [
  {
    label: "工作区",
    items: [
      { href: "/chat", label: "对话工作台", icon: MessageCircle },
      { href: "/dashboard", label: "总览", icon: LayoutDashboard },
    ],
  },
  {
    label: "GEO 工作台",
    items: [
      { href: "/search-lab", label: "搜索实验室", icon: FlaskConical },
      { href: "/matrix", label: "品牌问题矩阵", icon: Grid3X3 },
      { href: "/compare", label: "两轮比较", icon: GitCompareArrows },
      { href: "/questions", label: "问题集", icon: ListChecks },
      { href: "/brands", label: "品牌管理", icon: Building2 },
      { href: "/analyses", label: "GEO 分析", icon: BarChart3 },
      { href: "/reports", label: "分析报告", icon: FileText },
      { href: "/visibility", label: "品牌可见度", icon: Eye },
      { href: "/competitors", label: "竞品分析", icon: Swords },
      { href: "/evidence", label: "证据库", icon: FolderOpen },
      { href: "/snapshots", label: "历史快照", icon: History },
      { href: "/optimization", label: "优化中心", icon: Wrench },
      { href: "/experiments", label: "实验对比", icon: GitCompareArrows },
      { href: "/tasks", label: "任务与用量", icon: Activity },
      { href: "/dashboard-tv", label: "数据大屏", icon: Monitor },
    ],
  },
  {
    label: "自动化",
    items: [{ href: "/schedules", label: "定时采集", icon: CalendarClock }],
  },
  {
    label: "系统设置",
    items: [{ href: "/settings", label: "设置", icon: Settings }],
  },
];

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex h-full flex-col bg-card">
      <div className="flex items-center gap-2 px-4 pb-4 pt-5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft">
          <Radar className="h-4 w-4 text-primary" />
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-[color:var(--text-primary)]">GEO Radar</span>
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 pb-4 scrollbar-thin">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-4 last:mb-0">
            <p className="mb-1.5 px-2.5 text-[10px] font-medium uppercase tracking-wider text-quaternary">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors duration-150",
                      active
                        ? "bg-primary-soft text-primary-strong"
                        : "text-secondary-soft hover:bg-surface-muted hover:text-[color:var(--text-primary)]"
                    )}
                  >
                    <item.icon
                      className={cn(
                        "h-4 w-4 shrink-0 transition-colors",
                        active ? "text-primary" : "text-quaternary group-hover:text-tertiary"
                      )}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-border px-4 py-3">
        <p className="text-[11px] leading-5 text-quaternary">
          用可追溯的搜索证据，
          <br />
          看见品牌在搜索中的真实位置。
        </p>
      </div>
    </nav>
  );
}
