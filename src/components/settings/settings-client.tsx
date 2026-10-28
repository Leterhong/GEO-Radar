"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CredentialStatusBadge } from "@/components/shared/status-badges";
import { ApiTokenManager } from "@/components/settings/api-token-manager";
import { formatDate, formatDuration } from "@/lib/utils";
import { Eye, EyeOff, Save, PlugZap, Trash2, Ban, CheckCircle2, Plus, KeyRound, ShieldCheck, XCircle } from "lucide-react";

interface CredentialConfig {
  provider: "YUANBAO";
  configured: boolean;
  status: "NOT_CONFIGURED" | "PENDING_VERIFICATION" | "CONNECTED" | "FAILED" | "DISABLED";
  maskedKey: string | null;
  updatedAt: string | null;
  lastTestedAt: string | null;
  lastTestDurationMs: number | null;
  lastTestRequestId: string | null;
  lastTestOk: boolean | null;
  lastErrorMessage: string | null;
  globallyEnabled: boolean;
  encryptionConfigured: boolean;
}

interface TestResult {
  success: boolean;
  testedAt: string;
  durationMs: number | null;
  requestId: string | null;
  providerVersion: string | null;
  resultCount: number | null;
  errorCategory: string | null;
  errorMessage: string | null;
  madeRealRequest: boolean;
  notice?: string;
}

interface ModelTestResult {
  success: boolean;
  testedAt: string;
  durationMs: number | null;
  model: string | null;
  errorCategory: string | null;
  errorMessage: string | null;
  madeRealRequest: boolean;
  notice?: string;
}

async function saveModelConfigAction(
  input: { displayName?: string; baseUrl: string; modelName: string; apiKey: string }
): Promise<{ ok: boolean; message: string }> {
  const res = await fetch("/api/settings/model-provider", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) return { ok: false, message: json?.error?.message ?? "保存失败" };
  return { ok: true, message: "模型配置已加密保存" };
}

interface ModelCredentialConfig {
  provider: "OPENAI_COMPATIBLE";
  configured: boolean;
  status: "NOT_CONFIGURED" | "PENDING_VERIFICATION" | "CONNECTED" | "FAILED" | "DISABLED";
  displayName: string | null;
  baseUrl: string | null;
  modelName: string | null;
  maskedKey: string | null;
  updatedAt: string | null;
  lastTestedAt: string | null;
  lastTestDurationMs: number | null;
  lastTestOk: boolean | null;
  lastErrorMessage: string | null;
  encryptionConfigured: boolean;
}

export function SettingsClient({
  user,
  workspaces,
  credential,
  modelCredential,
}: {
  user: { name: string; email: string };
  workspaces: Array<{ id: string; name: string; role: string; isCurrent: boolean }>;
  credential: CredentialConfig | null;
  modelCredential?: ModelCredentialConfig | null;
}) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  // 大模型配置
  const [modelBaseUrl, setModelBaseUrl] = useState(modelCredential?.baseUrl ?? "");
  const [modelName, setModelName] = useState(modelCredential?.modelName ?? "");
  const [modelKey, setModelKey] = useState("");
  const [modelSaving, setModelSaving] = useState(false);
  const [modelTesting, setModelTesting] = useState(false);
  const [modelTestResult, setModelTestResult] = useState<ModelTestResult | null>(null);
  const [newWsName, setNewWsName] = useState("");
  const [creatingWs, setCreatingWs] = useState(false);

  async function handleSaveKey() {
    if (apiKey.trim() === "") {
      toast.error("请填写 API Key");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/search-provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "保存失败");
        return;
      }
      toast.success("API Key 已加密保存。请点击“测试连接”完成验证（会产生一次真实请求）。");
      setApiKey("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/search-provider/test", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "测试失败");
        return;
      }
      setTestResult(json.data);
      if (json.data.success) {
        toast.success(`连接成功（${formatDuration(json.data.durationMs)}），已标记为已连接`);
      } else {
        toast.error(json.data.errorMessage ?? "连接测试失败");
      }
      router.refresh();
    } finally {
      setTesting(false);
    }
  }

  async function handleClearKey() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/search-provider", { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "清除失败");
        return;
      }
      toast.success("已清除密钥");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveModel() {
    if (modelBaseUrl.trim() === "" || modelName.trim() === "" || modelKey.trim() === "") {
      toast.error("请填写 Base URL、模型名称与 API Key");
      return;
    }
    setModelSaving(true);
    try {
      const result = await saveModelConfigAction({ baseUrl: modelBaseUrl.trim(), modelName: modelName.trim(), apiKey: modelKey.trim() });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("模型配置已保存。请点击「测试连接」完成验证（产生少量真实 Token 消耗）。");
      setModelKey("");
      router.refresh();
    } finally {
      setModelSaving(false);
    }
  }

  async function handleTestModel() {
    setModelTesting(true);
    setModelTestResult(null);
    try {
      const res = await fetch("/api/settings/model-provider/test", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "测试失败");
        return;
      }
      setModelTestResult(json.data);
      if (json.data.success) toast.success(`模型连接成功（${formatDuration(json.data.durationMs)}）`);
      else toast.error(json.data.errorMessage ?? "连接测试失败");
      router.refresh();
    } finally {
      setModelTesting(false);
    }
  }

  async function handleClearModel() {
    setModelSaving(true);
    try {
      const res = await fetch("/api/settings/model-provider", { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "清除失败");
        return;
      }
      toast.success("已清除模型配置");
      router.refresh();
    } finally {
      setModelSaving(false);
    }
  }

  async function handleDisable(disabled: boolean) {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/search-provider/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "操作失败");
        return;
      }
      toast.success(disabled ? "数据源已禁用" : "数据源已重新启用（需重新测试连接）");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateWorkspace() {
    if (newWsName.trim() === "") {
      toast.error("请填写工作空间名称");
      return;
    }
    setCreatingWs(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newWsName.trim() }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json?.error?.message ?? "创建失败");
        return;
      }
      await fetch("/api/workspaces/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: json.data.id }),
      });
      toast.success("工作空间已创建并切换");
      setNewWsName("");
      router.refresh();
    } finally {
      setCreatingWs(false);
    }
  }

  return (
    <Tabs defaultValue="datasource">
      <TabsList>
        <TabsTrigger value="datasource">元宝搜索数据源</TabsTrigger>
        <TabsTrigger value="model">大模型</TabsTrigger>
        <TabsTrigger value="workspace">工作空间</TabsTrigger>
        <TabsTrigger value="tokens">API Token / MCP</TabsTrigger>
        <TabsTrigger value="profile">个人资料</TabsTrigger>
      </TabsList>

      <TabsContent value="datasource" className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">元宝搜索连接</CardTitle>
                <CardDescription>
                  使用腾讯云元宝搜索「服务 API Key 方式」。密钥仅在服务端解密使用，前端只显示掩码。
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <CredentialStatusBadge status={credential?.status ?? "NOT_CONFIGURED"} />
                {!credential?.globallyEnabled ? <Badge variant="warning">服务端未启用</Badge> : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!credential?.encryptionConfigured ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  服务端尚未配置 CREDENTIAL_ENCRYPTION_KEY，无法安全保存密钥（不会降级为明文存储）。
                  请参考 .env.example 配置后重启服务。
                </span>
              </div>
            ) : null}

            {credential?.configured ? (
              <div className="space-y-3 rounded-md border bg-surface-subtle p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <KeyRound className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono">{credential.maskedKey}</span>
                  </div>
                  <span className="text-[12px] text-tertiary">更新于 {formatDate(credential.updatedAt)}</span>
                </div>
                {credential.lastTestedAt ? (
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-tertiary">
                    <span>
                      最近测试：{formatDate(credential.lastTestedAt)}
                      {credential.lastTestDurationMs !== null ? ` · 耗时 ${formatDuration(credential.lastTestDurationMs)}` : ""}
                    </span>
                    {credential.lastTestRequestId ? (
                      <span className="font-mono">RequestId: {credential.lastTestRequestId}</span>
                    ) : null}
                    {credential.lastTestOk === true ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <CheckCircle2 className="h-3.5 w-3.5" /> 成功
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <XCircle className="h-3.5 w-3.5" /> 失败
                      </span>
                    )}
                  </div>
                ) : null}
                {credential.lastErrorMessage ? (
                  <p className="text-xs text-destructive">{credential.lastErrorMessage}</p>
                ) : null}
              </div>
            ) : (
              <p className="rounded-md border border-dashed p-4 text-[13px] text-muted-foreground">
                尚未配置 API Key。请登录腾讯云元宝搜索控制台创建 API Key（每个账号最多 3 个），填入下方并保存。
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="apiKey">API Key {credential?.configured ? "（留空则不修改）" : ""}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="apiKey"
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={credential?.configured ? "输入新 Key 将覆盖旧 Key" : "粘贴你的服务 API Key"}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                    aria-label={showKey ? "隐藏密钥" : "显示密钥"}
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button onClick={handleSaveKey} disabled={saving || !credential?.encryptionConfigured}>
                  <Save className="mr-1 h-4 w-4" /> 保存
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleTestConnection} disabled={testing || !credential?.configured}>
                <PlugZap className="mr-1 h-4 w-4" /> {testing ? "测试中…" : "测试连接"}
              </Button>
              {credential?.configured && credential.status !== "DISABLED" ? (
                <Button variant="outline" onClick={() => handleDisable(true)} disabled={saving}>
                  <Ban className="mr-1 h-4 w-4" /> 禁用数据源
                </Button>
              ) : null}
              {credential?.configured && credential.status === "DISABLED" ? (
                <Button variant="outline" onClick={() => handleDisable(false)} disabled={saving}>
                  <CheckCircle2 className="mr-1 h-4 w-4" /> 重新启用
                </Button>
              ) : null}
              {credential?.configured ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={saving}>
                      <Trash2 className="mr-1 h-4 w-4" /> 清除密钥
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>确认清除 API Key？</AlertDialogTitle>
                      <AlertDialogDescription>
                        清除后数据源回到「未配置」状态，正在执行的真实搜索任务不受影响，但新的真实任务将被阻止。此操作不可撤销。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={handleClearKey}>
                        确认清除
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>

            <p className="text-[12px] text-tertiary">
              注意：「测试连接」会使用已保存的密钥向元宝搜索发起一次真实的搜索请求（Query-only 最小请求），可能产生实际调用费用；连接状态只能通过真实测试更新。
            </p>

            {testResult ? (
              <div
                className={`rounded-md border p-4 text-sm ${
                  testResult.success ? "border-success/25 bg-success-soft" : "border-destructive/25 bg-destructive/10"
                }`}
              >
                <p className="font-medium">{testResult.success ? "连接测试成功" : "连接测试失败"}</p>
                <ul className="mt-2 space-y-1 text-[12px] text-tertiary">
                  <li>测试时间：{formatDate(testResult.testedAt)}</li>
                  {testResult.durationMs !== null ? <li>耗时：{formatDuration(testResult.durationMs)}</li> : null}
                  {testResult.requestId ? <li className="font-mono">RequestId：{testResult.requestId}</li> : null}
                  {testResult.providerVersion ? <li>供应商版本：{testResult.providerVersion}</li> : null}
                  {testResult.resultCount !== null ? <li>返回结果：{testResult.resultCount} 条</li> : null}
                  {testResult.errorCategory ? <li>错误类别：{testResult.errorCategory}</li> : null}
                  {testResult.errorMessage ? <li className="text-destructive">{testResult.errorMessage}</li> : null}
                </ul>
              </div>
            ) : null}

            <div className="flex items-start gap-2 rounded-md border bg-surface-subtle p-3 text-[12px] text-tertiary">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <span>
                安全说明：密钥使用 AES-256-GCM 加密存储（密钥由服务端环境变量 CREDENTIAL_ENCRYPTION_KEY 管理）；
                不写入日志、URL 或错误响应；保存后任何接口都不会返回完整密钥；支持替换、禁用与清除。
              </span>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="model" className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">大模型连接（OpenAI 兼容）</CardTitle>
                <CardDescription>
                  用于「搜索问答」与「GEO 分析」模式。API Key 与元宝密钥分开加密存储，前端只显示掩码。
                </CardDescription>
              </div>
              <Badge variant={modelCredential?.configured ? "default" : "muted"}>
                {modelCredential?.configured ? `已配置（${modelCredential.modelName ?? "模型"}）` : "未配置"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {modelCredential?.configured ? (
              <div className="space-y-1 rounded-md border bg-surface-subtle p-3 text-[12px] text-tertiary">
                <p>
                  Base URL：<span className="font-mono">{modelCredential.baseUrl}</span> · 模型：
                  <span className="font-mono">{modelCredential.modelName}</span> · Key：
                  <span className="font-mono">{modelCredential.maskedKey}</span>
                </p>
                {modelCredential.lastTestedAt ? (
                  <p>
                    最近测试：{formatDate(modelCredential.lastTestedAt)}
                    {modelCredential.lastTestDurationMs !== null ? ` · ${formatDuration(modelCredential.lastTestDurationMs)}` : ""}
                    {modelCredential.lastTestOk === true ? " · 成功" : " · 失败"}
                    {modelCredential.lastErrorMessage ? ` · ${modelCredential.lastErrorMessage}` : ""}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="modelBaseUrl">API Base URL</Label>
                <Input
                  id="modelBaseUrl"
                  value={modelBaseUrl}
                  onChange={(e) => setModelBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1 或兼容端点"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="modelName">模型名称</Label>
                <Input id="modelName" value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="例如 gpt-4o-mini / deepseek-chat" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="modelKey">API Key {modelCredential?.configured ? "（留空则不修改）" : ""}</Label>
              <Input
                id="modelKey"
                type="password"
                value={modelKey}
                onChange={(e) => setModelKey(e.target.value)}
                placeholder={modelCredential?.configured ? "输入新 Key 将覆盖" : "sk-..."}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSaveModel} disabled={modelSaving}>
                <Save className="mr-1 h-4 w-4" /> 保存
              </Button>
              <Button variant="outline" onClick={handleTestModel} disabled={modelTesting || !modelCredential?.configured}>
                <PlugZap className="mr-1 h-4 w-4" /> {modelTesting ? "测试中…" : "测试连接"}
              </Button>
              {modelCredential?.configured ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={modelSaving}>
                      <Trash2 className="mr-1 h-4 w-4" /> 清除配置
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>确认清除大模型配置？</AlertDialogTitle>
                      <AlertDialogDescription>
                        清除后「搜索问答」与「GEO 分析」将无法生成回答（搜索证据模式不受影响）。此操作不可撤销。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={handleClearModel}>
                        确认清除
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>
            <p className="text-[12px] text-tertiary">
              「测试连接」会向模型服务发起一次真实的对话请求（回复 OK），产生少量 Token 消耗；只有真实成功才标记为已连接。
            </p>
            {modelTestResult ? (
              <div
                className={`rounded-md border p-4 text-sm ${
                  modelTestResult.success ? "border-success/25 bg-success-soft" : "border-destructive/25 bg-destructive/10"
                }`}
              >
                <p className="font-medium">{modelTestResult.success ? "模型连接成功" : "模型连接失败"}</p>
                <ul className="mt-2 space-y-1 text-[12px] text-tertiary">
                  <li>测试时间：{formatDate(modelTestResult.testedAt)}</li>
                  {modelTestResult.durationMs !== null ? <li>耗时：{formatDuration(modelTestResult.durationMs)}</li> : null}
                  {modelTestResult.model ? <li>模型：{modelTestResult.model}</li> : null}
                  {modelTestResult.errorMessage ? <li className="text-destructive">{modelTestResult.errorMessage}</li> : null}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="workspace" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">工作空间</CardTitle>
            <CardDescription>所有品牌、问题、任务与证据都按工作空间隔离。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="divide-y rounded-md border">
              {workspaces.map((w) => (
                <li key={w.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span>
                    {w.name}
                    {w.isCurrent ? <Badge variant="secondary" className="ml-2">当前</Badge> : null}
                  </span>
                  <span className="text-[12px] text-tertiary">{w.role}</span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Input value={newWsName} onChange={(e) => setNewWsName(e.target.value)} placeholder="新工作空间名称" />
              <Button variant="outline" onClick={handleCreateWorkspace} disabled={creatingWs}>
                <Plus className="mr-1 h-4 w-4" /> 创建并切换
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="tokens">
        <ApiTokenManager />
      </TabsContent>

      <TabsContent value="profile">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">个人资料</CardTitle>
            <CardDescription>当前登录账号信息。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <Label className="text-muted-foreground">用户名</Label>
              <p>{user.name}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">邮箱</Label>
              <p>{user.email}</p>
            </div>
            <p className="text-[12px] text-tertiary">
              头像上传与密码修改将在后续版本提供；当前可通过退出登录保障账号安全。
            </p>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
