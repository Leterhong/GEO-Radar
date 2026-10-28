import Link from "next/link";
import { prisma } from "@/server/db/client";
import { requireWorkspace } from "@/server/auth/guard";
import { PageHeader, EmptyState, InlineAlert } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TaskStatusBadge } from "@/components/shared/status-badges";
import { formatDate } from "@/lib/utils";
import { ArrowUpRight, History } from "lucide-react";
import { SnapshotActions } from "@/components/snapshots/snapshot-actions";

export const dynamic = "force-dynamic";

interface SnapshotSummary {
  totalQuestions?: number;
  validQuestions?: number;
  failedItems?: number;
  emptyItems?: number;
  needsReviewEvidence?: number;
  totalEvidence?: number;
}

export default async function SnapshotsPage({
  searchParams,
}: {
  searchParams: { brandId?: string; taskId?: string };
}) {
  const { workspaceId } = await requireWorkspace();
  const snapshots = await prisma.analysisSnapshot.findMany({
    where: {
      workspaceId,
      ...(searchParams.taskId ? { taskId: searchParams.taskId } : {}),
      ...(searchParams.brandId ? { task: { brandId: searchParams.brandId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      task: {
        select: {
          id: true,
          name: true,
          status: true,
          brandId: true,
          brand: { select: { name: true } },
          executionMode: true,
          questionSetVersion: true,
          finishedAt: true,
        },
      },
    },
  });

  const byTask = new Map<string, { task: (typeof snapshots)[number]["task"]; snapshots: typeof snapshots }>();
  for (const snapshot of snapshots) {
    const entry = byTask.get(snapshot.taskId) ?? { task: snapshot.task, snapshots: [] };
    entry.snapshots.push(snapshot);
    byTask.set(snapshot.taskId, entry);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="历史快照"
        description="每轮采集完成时保存不可变分析快照；用新规则重算会生成新的 RECOMPUTE 快照，不覆盖历史 COLLECTION 快照，也不修改原始搜索结果。"
      />
      {snapshots.length === 0 ? (
        <EmptyState
          title="还没有采集快照"
          description="执行并完成一轮真实搜索任务后，系统会自动保存采集快照。也可以在任务详情中手动补建快照。"
          action={
            <Link href="/search-lab" className="text-[13px] text-primary hover:underline">
              前往搜索实验室 →
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          <InlineAlert tone="info" title="快照与当前分析的区别">
            COLLECTION 为采集完成时的分析结果；RECOMPUTE 为使用当前品牌配置/规则重算的结果。两者并列保存，报告中会注明使用的规则版本。
          </InlineAlert>
          {Array.from(byTask.entries()).map(([taskId, entry]) => {
            const latest = entry.snapshots[0];
            const summary = (latest?.summary ?? {}) as { counts?: SnapshotSummary; brandName?: string | null };
            const counts = summary.counts ?? {};
            return (
              <Card key={taskId}>
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/search-lab/${taskId}`} className="text-[15px] font-semibold hover:text-primary hover:underline">
                          {entry.task.name}
                        </Link>
                        <TaskStatusBadge status={entry.task.status} />
                        <Badge variant="secondary">{entry.task.brand?.name ?? "未关联品牌"}</Badge>
                        <Badge variant={entry.task.executionMode === "MOCK" ? "warning" : "success"}>
                          {entry.task.executionMode === "MOCK" ? "模拟" : "真实"}
                        </Badge>
                        <Badge variant="muted">问题集 v{entry.task.questionSetVersion ?? "未知"}</Badge>
                      </div>
                      <p className="mt-1 text-[11px] text-quaternary">
                        完成于 {entry.task.finishedAt ? formatDate(entry.task.finishedAt) : "—"} · 快照 {entry.snapshots.length} 个
                      </p>
                    </div>
                    <SnapshotActions taskId={taskId} brandId={entry.task.brandId} />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4 lg:grid-cols-6">
                    <div className="rounded-md bg-surface-muted px-2.5 py-1.5">有效问题：{counts.validQuestions ?? "—"} / {counts.totalQuestions ?? "—"}</div>
                    <div className="rounded-md bg-surface-muted px-2.5 py-1.5">失败：{counts.failedItems ?? "—"}</div>
                    <div className="rounded-md bg-surface-muted px-2.5 py-1.5">空结果：{counts.emptyItems ?? "—"}</div>
                    <div className="rounded-md bg-surface-muted px-2.5 py-1.5">证据：{counts.totalEvidence ?? "—"}</div>
                    <div className="rounded-md bg-surface-muted px-2.5 py-1.5">待复核：{counts.needsReviewEvidence ?? "—"}</div>
                    <div className="rounded-md bg-surface-muted px-2.5 py-1.5">证据截断：{latest?.truncated ? "是" : "否"}</div>
                  </div>

                  <div className="mt-3 divide-y divide-border rounded-lg border border-border">
                    {entry.snapshots.map((snapshot) => (
                      <div key={snapshot.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[11px]">
                        <Badge variant={snapshot.kind === "COLLECTION" ? "info" : "secondary"}>
                          {snapshot.kind === "COLLECTION" ? "采集快照" : "重算快照"}
                        </Badge>
                        <span className="font-mono text-[10px] text-tertiary">{snapshot.ruleVersion}</span>
                        <span className="text-quaternary">证据 {snapshot.evidenceCount} 条{snapshot.truncated ? "（已截断）" : ""}</span>
                        <span className="ml-auto text-quaternary">{formatDate(snapshot.createdAt)}</span>
                        <Link href={`/reports?taskId=${taskId}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                          生成报告 <ArrowUpRight className="h-3 w-3" />
                        </Link>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-4 flex items-center gap-1.5 text-[11px] text-quaternary">
        <History className="h-3.5 w-3.5" /> 快照保存的是分析结果与当时的问题文本；原始搜索结果仍可在任务详情中追溯。
      </p>
    </div>
  );
}
