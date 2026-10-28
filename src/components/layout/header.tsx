"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CredentialStatus } from "@prisma/client";
import { LogOut, Plus, User, MonitorPlay, Menu, X, ChevronsUpDown } from "lucide-react";
import { SidebarNav } from "@/components/layout/sidebar";

export interface HeaderProps {
  userEmail: string;
  userName: string;
  workspaces: Array<{ id: string; name: string }>;
  activeWorkspaceId: string;
  credentialStatus: CredentialStatus;
  modelConfigured?: boolean;
}

export function DashboardHeader({
  userEmail,
  userName,
  workspaces,
  activeWorkspaceId,
  credentialStatus,
  modelConfigured = false,
}: HeaderProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [switching, setSwitching] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  async function switchWorkspace(workspaceId: string) {
    if (workspaceId === activeWorkspaceId) return;
    setSwitching(workspaceId);
    try {
      const res = await fetch("/api/workspaces/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "切换工作空间失败");
        return;
      }
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setSwitching(null);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const activeName = workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? "未选择工作空间";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-card/85 px-4 backdrop-blur-md lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={() => setMobileNavOpen(true)}
          aria-label="打开导航"
        >
          <Menu className="h-4 w-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="max-w-[220px] gap-1.5 text-[13px] font-medium">
              <span className="truncate">{activeName}</span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-quaternary" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel className="text-[11px] font-normal text-quaternary">切换工作空间</DropdownMenuLabel>
            {workspaces.map((w) => (
              <DropdownMenuItem
                key={w.id}
                onClick={() => switchWorkspace(w.id)}
                disabled={pending || switching === w.id}
                className="justify-between"
              >
                <span className="truncate">{w.name}</span>
                {w.id === activeWorkspaceId ? <span className="text-[10px] text-primary">当前</span> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => (window.location.href = "/settings?tab=workspace")}>
              <Plus className="mr-2 h-3.5 w-3.5" /> 新建工作空间
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="hidden shrink-0 items-center gap-1.5 md:flex">
          <SearchStatusChip status={credentialStatus} />
          <ModelStatusChip configured={modelConfigured} />
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
          <a href="/dashboard-tv" target="_blank" rel="noreferrer">
            <MonitorPlay className="mr-1.5 h-3.5 w-3.5" /> 大屏
          </a>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-soft text-primary">
                <User className="h-3.5 w-3.5" />
              </span>
              <span className="hidden max-w-[120px] truncate sm:inline">{userName}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate text-[11px] font-normal text-quaternary">{userEmail}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => (window.location.href = "/settings")}>个人设置</DropdownMenuItem>
            <DropdownMenuItem onClick={logout}>
              <LogOut className="mr-2 h-3.5 w-3.5" /> 退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 移动端抽屉导航 */}
      {mobileNavOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-[#172033]/25 backdrop-blur-[2px] animate-fade-in"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[260px] border-r border-border bg-card shadow-float animate-fade-in">
            <div className="flex justify-end px-3 pt-3">
              <Button variant="ghost" size="icon" onClick={() => setMobileNavOpen(false)} aria-label="关闭导航">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="h-[calc(100%-3rem)]">
              <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

/** 搜索数据源状态：文字明确，避免"未配置"歧义 */
function SearchStatusChip({ status }: { status: CredentialStatus }) {
  const map: Record<CredentialStatus, { label: string; className: string }> = {
    NOT_CONFIGURED: { label: "搜索未配置", className: "bg-surface-muted text-tertiary" },
    PENDING_VERIFICATION: { label: "搜索待验证", className: "bg-warning-soft text-warning" },
    CONNECTED: { label: "搜索已连接", className: "bg-success-soft text-success" },
    FAILED: { label: "搜索连接失败", className: "bg-destructive/10 text-destructive" },
    DISABLED: { label: "搜索已禁用", className: "bg-surface-muted text-tertiary" },
  };
  const entry = map[status] ?? map.NOT_CONFIGURED;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${entry.className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {entry.label}
    </span>
  );
}

function ModelStatusChip({ configured }: { configured: boolean }) {
  return (
    <span
      className={
        configured
          ? "inline-flex items-center gap-1 rounded-md bg-success-soft px-2 py-1 text-[11px] font-medium text-success"
          : "inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-[11px] font-medium text-tertiary"
      }
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {configured ? "模型已配置" : "模型未配置"}
    </span>
  );
}
