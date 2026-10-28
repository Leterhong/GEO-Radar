import { prisma } from "@/server/db/client";
import { requireWorkspace } from "@/server/auth/guard";
import { PageHeader } from "@/components/shared/kpi-card";
import { SearchLabClient } from "@/components/search-lab/search-lab-client";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function SearchLabPage() {
  const { workspaceId } = await requireWorkspace();
  const [brands, sets, credential, tasks] = await Promise.all([
    prisma.brand.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    prisma.questionSet.findMany({
      where: { workspaceId },
      include: { questions: { where: { enabled: true }, select: { id: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.searchProviderCredential.findUnique({ where: { workspaceId } }),
    prisma.searchTask.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { brand: { select: { name: true } }, creator: { select: { name: true } } },
    }),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="搜索实验室"
        description="创建并执行搜索任务。真实搜索会调用元宝搜索接口并产生实际请求，执行前需要你确认请求数量。"
      />
      <SearchLabClient
        brands={brands}
        questionSets={sets.map((s) => ({ id: s.id, name: s.name, questionCount: s.questions.length }))}
        credentialStatus={credential?.status ?? "NOT_CONFIGURED"}
        hasCredential={Boolean(credential?.encryptedSecret)}
        globallyEnabled={env.yuanbaoSearchEnabled}
        initialTasks={tasks.map((t) => ({
          id: t.id,
          name: t.name,
          brandName: t.brand?.name ?? null,
          executionMode: t.executionMode,
          provider: t.provider,
          status: t.status,
          totalItems: t.totalItems,
          successItems: t.successItems,
          failedItems: t.failedItems,
          createdAt: t.createdAt.toISOString(),
          finishedAt: t.finishedAt?.toISOString() ?? null,
          creatorName: t.creator.name,
        }))}
      />
    </div>
  );
}
