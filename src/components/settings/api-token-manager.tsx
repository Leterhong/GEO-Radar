"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/utils";

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  user: { email: string; name: string };
}

export function ApiTokenManager() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("MCP token");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/tokens");
      const json = await res.json();
      if (res.ok && json.ok) setTokens(json.data.tokens);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createToken() {
    setBusy(true);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "创建失败");
        return;
      }
      setCreated(json.data.token);
      toast.success("Token 已创建，只显示这一次");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    const res = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      toast.error(json?.error?.message ?? "撤销失败");
      return;
    }
    toast.success("Token 已撤销");
    await load();
  }

  async function copyCreated() {
    if (!created) return;
    await navigator.clipboard.writeText(created);
    toast.success("已复制 Token");
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Agent / MCP Token
          </CardTitle>
          <CardDescription>
            供 MCP、Agent Skill、DSH 插件和 CLI 使用。Token 只在创建时显示一次，服务端只保存 SHA-256 哈希。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="token-name">Token 名称</Label>
              <Input
                id="token-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：DSH MCP / Claude Code"
                maxLength={80}
              />
            </div>
            <Button onClick={createToken} disabled={busy || !name.trim()}>
              <Plus className="mr-1 h-4 w-4" /> 创建 Token
            </Button>
          </div>

          {created && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="mb-1 text-xs font-medium text-amber-800">只显示这一次，请立即复制：</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-white px-2 py-1.5 text-xs">
                  {created}
                </code>
                <Button size="sm" variant="outline" onClick={copyCreated}>
                  <Copy className="mr-1 h-3.5 w-3.5" /> 复制
                </Button>
              </div>
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            使用方式：`GEO_RADAR_URL=http://127.0.0.1:3000`，`GEO_RADAR_TOKEN=…`。
            MCP server 位于 `packages/geo-radar-mcp`；DSH 插件位于 `packages/dsh-geo-radar`。
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>已创建的 Token</CardTitle>
          <CardDescription>撤销后，使用该 Token 的 MCP/CLI 会立即失效。</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有 Token。</p>
          ) : (
            <div className="divide-y divide-border">
              {tokens.map((token) => (
                <div key={token.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{token.name}</span>
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {token.prefix}…
                      </Badge>
                      {token.scopes.map((scope) => (
                        <Badge key={scope} variant="outline" className="text-[10px]">
                          {scope}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {token.user.email} · 创建于 {formatDate(token.createdAt)}
                      {token.lastUsedAt ? ` · 最近使用 ${formatDate(token.lastUsedAt)}` : " · 尚未使用"}
                      {token.expiresAt ? ` · 过期 ${formatDate(token.expiresAt)}` : " · 长期有效"}
                    </p>
                  </div>
                  <Button size="sm" variant="destructive" onClick={() => revoke(token.id)}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> 撤销
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
