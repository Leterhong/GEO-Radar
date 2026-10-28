"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Radar, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type StepState = "pending" | "active" | "done";

export function OnboardingForm({
  mode,
  initialWorkspaceName = "",
}: {
  /** full：创建工作空间 + 品牌；brand-setup：工作空间已存在，补充品牌档案 */
  mode: "full" | "brand-setup";
  initialWorkspaceName?: string;
}) {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState(initialWorkspaceName);
  const [brandName, setBrandName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [description, setDescription] = useState("");
  const [progress, setProgress] = useState<{ active: boolean; step: number; elapsedMs: number; skipped: boolean }>(
    { active: false, step: 0, elapsedMs: 0, skipped: false }
  );
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const steps =
    mode === "full"
      ? ["创建工作空间", "保存品牌档案", "进入工作台"]
      : ["保存品牌档案", "应用品牌配置", "进入工作台"];

  function startProgress() {
    const startedAt = Date.now();
    setProgress({ active: true, step: 0, elapsedMs: 0, skipped: false });
    timerRef.current = setInterval(() => {
      setProgress((prev) => ({ ...prev, elapsedMs: Date.now() - startedAt }));
    }, 200);
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function goDashboard() {
    stopTimer();
    router.replace("/dashboard");
    router.refresh();
  }

  async function handleSubmit(e: React.FormEvent, options: { skip?: boolean } = {}) {
    e.preventDefault();
    setError(null);
    const skip = options.skip === true;
    if (!skip) {
      if (mode === "full" && workspaceName.trim() === "") return setError("请填写工作空间名称");
      if (brandName.trim() === "") return setError("请填写品牌名称（也可以选择跳过）");
    }

    startProgress();
    if (skip) setProgress((prev) => ({ ...prev, skipped: true }));
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceName: workspaceName.trim(),
          brand: skip
            ? {}
            : { name: brandName.trim(), websiteUrl, description },
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        stopTimer();
        setProgress({ active: false, step: 0, elapsedMs: 0, skipped: false });
        setError(json?.error?.message ?? "初始化失败，请稍后重试");
        return;
      }
      // 服务端已在同一请求内完成全部写入，这里推进真实步骤状态
      setProgress((prev) => ({ ...prev, step: 2 }));
      toast.success(skip ? "已跳过，正在进入工作台…" : "初始化完成，正在进入工作台…");
      setTimeout(() => goDashboard(), 180);
    } catch {
      stopTimer();
      setProgress({ active: false, step: 0, elapsedMs: 0, skipped: false });
      setError("网络异常，请稍后重试");
    }
  }

  if (progress.active) {
    const elapsedSeconds = (progress.elapsedMs / 1000).toFixed(1);
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-2">
            <Radar className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold">GEO Radar 首次配置</span>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{progress.skipped ? "正在跳过配置" : "正在初始化"}</CardTitle>
              <CardDescription>
                请求已发送到服务端，完成后会自动进入工作台；请勿关闭页面。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4" aria-live="polite" aria-busy="true">
              {/* 不确定进度条：真实请求尚未返回，不显示伪造的百分比 */}
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full w-1/3 animate-[onboarding-slide_1.3s_ease-in-out_infinite] rounded-full bg-primary" />
              </div>
              <ol className="space-y-2.5">
                {steps.map((label, index) => {
                  const state: StepState =
                    index < progress.step ? "done" : index === progress.step ? "active" : "pending";
                  return (
                    <li key={label} className="flex items-center gap-2 text-sm">
                      {state === "done" ? (
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-success/20">
                          <Check className="h-3 w-3 text-success" />
                        </span>
                      ) : state === "active" ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : (
                        <span className="h-4 w-4 rounded-full border border-border" />
                      )}
                      <span className={state === "pending" ? "text-muted-foreground" : ""}>{label}</span>
                    </li>
                  );
                })}
              </ol>
              <p className="text-[12px] text-tertiary">已用时 {elapsedSeconds}s</p>
            </CardContent>
          </Card>
          <style jsx>{`
            @keyframes onboarding-slide {
              0% {
                transform: translateX(-100%);
              }
              100% {
                transform: translateX(300%);
              }
            }
          `}</style>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-2">
          <Radar className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold">
            GEO Radar {mode === "full" ? "首次配置" : "完善品牌档案"}
          </span>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {mode === "full" ? "创建工作空间与品牌档案" : "填写品牌档案"}
            </CardTitle>
            <CardDescription>
              {mode === "full"
                ? "只需完成最基本的两步：命名工作空间、登记你的品牌。数据源与问题集可以稍后在对应页面配置。"
                : "品牌名称与官网域名决定可见度分析口径。也可以先跳过，之后在「品牌管理」中补充。"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
              {mode === "full" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="workspace">工作空间名称</Label>
                  <Input
                    id="workspace"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    placeholder="例如：市场部 GEO 项目"
                    maxLength={60}
                  />
                </div>
              ) : (
                <div className="rounded-md border bg-surface-subtle px-3 py-2 text-[12px] text-tertiary">
                  当前工作空间：<span className="font-medium text-foreground">{initialWorkspaceName || "已创建"}</span>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="brand">品牌名称</Label>
                <Input
                  id="brand"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="你的品牌名"
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="website">品牌官网（可选）</Label>
                <Input
                  id="website"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="desc">品牌描述（可选）</Label>
                <Textarea
                  id="desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="主营业务、产品或服务简介"
                />
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full">
                完成初始化
              </Button>
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={(e) => void handleSubmit(e as unknown as React.FormEvent, { skip: true })}
                >
                  暂时跳过，直接进入工作台
                </Button>
                <p className="text-[10px] text-muted-foreground">元宝 API Key 可稍后在设置中配置</p>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
