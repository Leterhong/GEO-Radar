"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Radar, Sparkles, ShieldCheck, LineChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const HIGHLIGHTS = [
  { icon: Sparkles, title: "真实搜索证据", description: "每一次回答都能追溯到具体来源与采集时间。" },
  { icon: LineChart, title: "可核算的 GEO 指标", description: "品牌出现率、官网覆盖率由业务代码计算，不由模型编造。" },
  { icon: ShieldCheck, title: "密钥留在服务端", description: "搜索与模型 API Key 加密存储，前端只见掩码。" },
];

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.includes("@")) {
      setError("请输入有效的邮箱地址");
      return;
    }
    if (password === "") {
      setError("请输入密码");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.error?.message ?? "登录失败，请稍后重试");
        return;
      }
      toast.success("登录成功");
      router.push(json.data.workspaceId ? "/dashboard" : "/onboarding");
      router.refresh();
    } catch {
      setError("网络异常，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* 左侧品牌区：柔和浅蓝渐变，仅占屏幕一部分 */}
      <div className="relative hidden w-[46%] flex-col justify-between bg-gradient-a p-10 lg:flex xl:p-14">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-card shadow-soft">
            <Radar className="h-4 w-4 text-primary" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-[color:var(--text-primary)]">GEO Radar</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-[32px] font-semibold leading-[1.25] tracking-tight text-[color:var(--text-primary)]">
            看见品牌在搜索中的
            <br />
            真实位置。
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-secondary-soft">
            用可追溯的搜索证据，发现品牌可见度缺口，制定优化任务，并通过复测观察变化。
          </p>
          <div className="mt-10 space-y-4">
            {HIGHLIGHTS.map((item) => (
              <div key={item.title} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border-strong bg-card">
                  <item.icon className="h-3.5 w-3.5 text-primary" />
                </span>
                <div>
                  <p className="text-[13px] font-medium text-[color:var(--text-primary)]">{item.title}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-tertiary">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-quaternary">真实搜索结果 · 可追溯证据 · 清晰统计口径</p>
      </div>

      {/* 右侧表单区 */}
      <div className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="w-full max-w-[380px] animate-fade-in">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-soft">
              <Radar className="h-4 w-4 text-primary" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">GEO Radar</span>
          </div>
          <h2 className="text-[24px] font-semibold tracking-tight text-[color:var(--text-primary)]">登录</h2>
          <p className="mt-1.5 text-[13px] text-muted-foreground">使用邮箱和密码登录 GEO Radar 工作台。</p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[12px] text-secondary-soft">
                邮箱
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-[12px] text-secondary-soft">
                密码
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-10"
              />
            </div>
            {error ? (
              <div className="space-y-1 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2">
                <p className="text-[12px] text-destructive">{error}</p>
                {error.includes("邮箱或密码") ? (
                  <p className="text-[11px] leading-relaxed text-tertiary">
                    密码区分大小写与首尾空格。当前版本暂不支持自助重置密码，可使用新邮箱注册。
                  </p>
                ) : null}
              </div>
            ) : null}
            <Button type="submit" className="h-10 w-full" disabled={loading}>
              {loading ? "登录中…" : "登录"}
            </Button>
          </form>

          <p className="mt-6 text-center text-[12px] text-muted-foreground">
            还没有账号？{" "}
            <Link href="/register" className="font-medium text-primary hover:text-primary-strong hover:underline">
              注册
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
