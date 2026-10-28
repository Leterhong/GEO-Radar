"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RegisterForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.includes("@")) return setError("请输入有效的邮箱地址");
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      return setError("密码至少 8 位，且需包含字母和数字");
    }
    if (password !== confirmPassword) return setError("两次输入的密码不一致");
    if (name.trim() === "") return setError("请填写用户名");
    if (!agree) return setError("请先阅读并同意用户协议与隐私政策");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: name.trim(), agreeTerms: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.error?.message ?? "注册失败，请稍后重试");
        return;
      }
      toast.success("注册成功，请补充品牌档案");
      // 工作空间已自动创建，进入「完善品牌」步骤（可跳过），完成后直接进入首页
      router.replace("/onboarding");
      router.refresh();
    } catch {
      setError("网络异常，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      <div className="relative hidden w-[44%] flex-col justify-between bg-gradient-b p-10 lg:flex xl:p-14">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-card shadow-soft">
            <Radar className="h-4 w-4 text-primary" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-[color:var(--text-primary)]">GEO Radar</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-[30px] font-semibold leading-[1.3] tracking-tight text-[color:var(--text-primary)]">
            从真实搜索结果出发，
            <br />
            了解品牌出现在哪里。
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-secondary-soft">
            注册后会自动创建你的第一个工作空间，随后补充品牌档案即可开始分析。
          </p>
          <ul className="mt-8 space-y-3 text-[13px] text-secondary-soft">
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-blue" />
              问题集 → 真实搜索 → 证据归档 → 品牌分析，一条完整链路
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-mint" />
              失败与取消的问题不计入指标分母，口径始终可查
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-violet" />
              搜索与模型密钥只在服务端解密使用
            </li>
          </ul>
        </div>
        <p className="text-[11px] text-quaternary">无需配置域名 · 本地即可运行</p>
      </div>

      <div className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="w-full max-w-[380px] animate-fade-in">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-soft">
              <Radar className="h-4 w-4 text-primary" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">GEO Radar</span>
          </div>
          <h2 className="text-[24px] font-semibold tracking-tight text-[color:var(--text-primary)]">创建账号</h2>
          <p className="mt-1.5 text-[13px] text-muted-foreground">注册后自动创建你的第一个工作空间。</p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-3.5" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-[12px] text-secondary-soft">
                用户名
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="你的名字或团队名"
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[12px] text-secondary-soft">
                邮箱
              </Label>
              <Input
                id="email"
                type="email"
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 8 位，含字母和数字"
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm" className="text-[12px] text-secondary-soft">
                确认密码
              </Label>
              <Input
                id="confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="h-10"
              />
            </div>
            <label className="flex items-start gap-2 rounded-lg border border-border bg-surface-subtle px-3 py-2.5 text-[11px] leading-relaxed text-tertiary">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-input accent-[var(--primary)]"
              />
              <span>
                我已阅读并同意用户协议与隐私政策。配置的搜索与模型 API Key 将在服务端加密存储，不会展示或传出。
              </span>
            </label>
            {error ? (
              <p className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="h-10 w-full" disabled={loading}>
              {loading ? "注册中…" : "创建账号"}
            </Button>
          </form>

          <p className="mt-6 text-center text-[12px] text-muted-foreground">
            已有账号？{" "}
            <Link href="/login" className="font-medium text-primary hover:text-primary-strong hover:underline">
              登录
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
