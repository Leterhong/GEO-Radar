"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RefreshCw, GitCompareArrows, BarChart3 } from "lucide-react";

export function SnapshotActions({ taskId, brandId }: { taskId: string; brandId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function reanalyze() {
    setBusy(true);
    try {
      const res = await fetch(`/api/search-tasks/${taskId}/snapshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "RECOMPUTE" }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "重新分析失败");
        return;
      }
      toast.success(`已用当前规则重新分析并生成快照（更新 ${json.data.updated} 条证据）`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={() => void reanalyze()} disabled={busy}>
        <RefreshCw className={`mr-1 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> 用当前规则重算
      </Button>
      <Button size="sm" variant="outline" asChild>
        <Link href={`/matrix?brandId=${brandId ?? ""}`}>查看矩阵</Link>
      </Button>
      <Button size="sm" variant="outline" asChild>
        <Link href={`/compare?retest=${taskId}`}>
          <GitCompareArrows className="mr-1 h-3.5 w-3.5" /> 与上一轮比较
        </Link>
      </Button>
      <Button size="sm" variant="outline" asChild>
        <Link href={`/reports?taskId=${taskId}`}>
          <BarChart3 className="mr-1 h-3.5 w-3.5" /> 生成报告
        </Link>
      </Button>
    </div>
  );
}
