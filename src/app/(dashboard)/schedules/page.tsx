import { prisma } from "@/server/db/client";
import { requireWorkspace } from "@/server/auth/guard";
import { PageHeader } from "@/components/shared/kpi-card";
import { SchedulesClient } from "@/components/schedules/schedules-client";
import { evaluateRealModeGuard } from "@/server/services/search-execution";

export const dynamic = "force-dynamic";

export default async function SchedulesPage() {
  const { workspaceId } = await requireWorkspace();
  const [brands, questionSets, credential] = await Promise.all([
    prisma.brand.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, select: { id: true, name: true } }),
    prisma.questionSet.findMany({
      where: { workspaceId, archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        currentVersion: true,
        questions: { where: { enabled: true }, select: { id: true } },
      },
    }),
    prisma.searchProviderCredential.findUnique({ where: { workspaceId } }),
  ]);
  const guard = evaluateRealModeGuard(credential);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="定时采集"
        description="在手动复测稳定后启用。所有排期都需要明确确认调用成本；可暂停、恢复、取消，并查看每次执行记录。定时执行由外部 cron 或独立 scheduler 进程触发，不依赖浏览器页面。"
      />
      <SchedulesClient
        brands={brands}
        questionSets={questionSets.map((set) => ({
          id: set.id,
          name: set.name,
          currentVersion: set.currentVersion,
          enabledCount: set.questions.length,
        }))}
        providerReady={guard.ok}
        providerReason={guard.ok ? null : guard.reason ?? null}
      />
    </div>
  );
}
