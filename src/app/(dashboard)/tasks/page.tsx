import { prisma } from "@/server/db/client";
import { requireWorkspace } from "@/server/auth/guard";
import { PageHeader, SectionTitle, EmptyState } from "@/components/shared/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TaskStatusBadge } from "@/components/shared/status-badges";
import { getUsageSummary } from "@/server/services/usage-service";
import { formatDate, formatDuration } from "@/lib/utils";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "任务与用量" };

const ANALYSIS_STATUS_LABEL: Record<string, string> = {
  QUEUED: "排队中",
  RUNNING: "执行中",
  COMPLETED: "已完成",
  PARTIALLY_COMPLETED: "部分完成",
  FAILED: "失败",
  CANCELLED: "已取消",
};

export default async function TasksPage() {
  const { workspaceId } = await requireWorkspace();
  const [searchTasks, analyses, usage, credential, model] = await Promise.all([
    prisma.searchTask.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { brand: { select: { name: true } }, _count: { select: { items: true } } },
    }),
    prisma.analysisTask.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { brand: { select: { name: true } } },
    }),
    getUsageSummary(workspaceId, 30),
    prisma.searchProviderCredential.findUnique({ where: { workspaceId } }),
    prisma.modelProviderCredential.findUnique({ where: { workspaceId } }),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="任务与用量"
        description="查看搜索任务、分析任务的真实状态，以及最近 30 天实际发生的调用量与已知 Token 用量。"
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-[12px] text-tertiary">搜索请求（近 30 天）</p>
            <p className="mt-1.5 text-[24px] font-semibold leading-none">{usage.searches.total}</p>
            <p className="mt-1.5 text-[11px] text-quaternary">失败 {usage.searches.failed} 次</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[12px] text-tertiary">模型调用（近 30 天）</p>
            <p className="mt-1.5 text-[24px] font-semibold leading-none">{usage.modelCalls.total}</p>
            <p className="mt-1.5 text-[11px] text-quaternary">失败 {usage.modelCalls.failed} 次</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[12px] text-tertiary">已知 Token 用量</p>
            <p className="mt-1.5 text-[24px] font-semibold leading-none">
              {usage.tokens.total === null ? "未知" : usage.tokens.total.toLocaleString()}
            </p>
            <p className="mt-1.5 text-[11px] text-quaternary">
              {usage.tokens.total === null ? "服务未返回用量字段" : `输入 ${usage.tokens.prompt ?? 0} / 输出 ${usage.tokens.completion ?? 0}`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[12px] text-tertiary">费用</p>
            <p className="mt-1.5 text-[24px] font-semibold leading-none">未知</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-quaternary">{usage.cost.note}</p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-tertiary">
        <span>服务状态：</span>
        <Badge variant={credential?.status === "CONNECTED" ? "success" : "muted"}>
          搜索 {credential?.status === "CONNECTED" ? "已连接" : "未连接"}
        </Badge>
        <Badge variant={model?.encryptedSecret && model.status !== "DISABLED" ? "success" : "muted"}>
          模型 {model?.encryptedSecret && model.status !== "DISABLED" ? "已配置" : "未配置"}
        </Badge>
        <span className="text-quaternary">
          用量仅统计真实发生的调用；更新于 {formatDate(new Date().toISOString())}
        </span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <SectionTitle
            title="搜索任务"
            description="对话与实验室产生的搜索任务"
            actions={
              <Link href="/search-lab" className="text-[12px] text-primary hover:underline">
                搜索实验室 →
              </Link>
            }
          />
          {searchTasks.length === 0 ? (
            <EmptyState title="暂无搜索任务" description="在对话工作台或搜索实验室发起后，任务会出现在这里。" />
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {searchTasks.map((task) => (
                <div key={task.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link href={`/search-lab/${task.id}`} className="truncate text-[12.5px] font-medium hover:text-primary">
                      {task.name}
                    </Link>
                    <p className="mt-0.5 text-[10.5px] text-quaternary">
                      {task.source === "CHAT" ? "对话" : "实验室"} · {task.brand?.name ?? "未关联品牌"} ·{" "}
                      {task.successItems}/{task.failedItems}/{task._count.items} · {formatDate(task.createdAt)}
                    </p>
                  </div>
                  <TaskStatusBadge status={task.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <SectionTitle
            title="GEO 分析任务"
            description="只读分析，不产生外部调用"
            actions={
              <Link href="/analyses" className="text-[12px] text-primary hover:underline">
                GEO 分析 →
              </Link>
            }
          />
          {analyses.length === 0 ? (
            <EmptyState title="暂无分析任务" description="在 GEO 分析页创建任务后，这里会显示执行状态。" />
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {analyses.map((task) => (
                <div key={task.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link href={`/analyses?id=${task.id}`} className="truncate text-[12.5px] font-medium hover:text-primary">
                      {task.name}
                    </Link>
                    <p className="mt-0.5 text-[10.5px] text-quaternary">
                      {task.brand?.name ?? "—"} · 有效回答 {task.answerCount} · {formatDate(task.createdAt)}
                    </p>
                  </div>
                  <Badge
                    variant={
                      task.status === "COMPLETED"
                        ? "success"
                        : task.status === "FAILED"
                          ? "destructive"
                          : task.status === "PARTIALLY_COMPLETED"
                            ? "warning"
                            : task.status === "RUNNING"
                              ? "info"
                              : "muted"
                    }
                  >
                    {ANALYSIS_STATUS_LABEL[task.status] ?? task.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6">
        <SectionTitle title="近期调用明细" description="只记录真实发生的外部调用（不含缓存命中与失败前未发出的请求）" />
        {usage.recent.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center text-[12px] text-tertiary">
            近 30 天没有记录到调用明细
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-[12px]">
              <thead className="bg-surface-subtle text-[11px] text-tertiary">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">类型</th>
                  <th className="px-3 py-2 text-left font-medium">服务</th>
                  <th className="px-3 py-2 text-left font-medium">模型</th>
                  <th className="px-3 py-2 text-left font-medium">Token（输入/输出）</th>
                  <th className="px-3 py-2 text-left font-medium">时间</th>
                </tr>
              </thead>
              <tbody>
                {usage.recent.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-3 py-2">{row.kind === "SEARCH" ? "搜索" : "模型"}</td>
                    <td className="px-3 py-2 text-tertiary">{row.provider}</td>
                    <td className="px-3 py-2 text-tertiary">{row.model ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-tertiary">
                      {row.promptTokens ?? "—"} / {row.completionTokens ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-tertiary">{formatDate(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-quaternary">
        说明：费用数据依赖服务商返回的计费字段，目前搜索与模型接口均未提供，因此保持「未知」，GEO Radar 不做估算。
        {usage.byDay.length > 0 ? ` 最近有调用的日期：${usage.byDay.slice(-3).map((d) => d.date).join("、")}。` : ""}
        {formatDuration(null) === "—" ? "" : ""}
      </p>
    </div>
  );
}
