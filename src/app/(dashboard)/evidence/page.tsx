import { prisma } from "@/server/db/client";
import { requireWorkspace } from "@/server/auth/guard";
import { PageHeader } from "@/components/shared/kpi-card";
import { EvidenceClient } from "@/components/evidence/evidence-client";

export const dynamic = "force-dynamic";

export default async function EvidencePage() {
  const { workspaceId } = await requireWorkspace();
  const [brands, tasks] = await Promise.all([
    prisma.brand.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    prisma.searchTask.findMany({
      where: { workspaceId },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="证据库"
        description="每次真实搜索返回的网页证据都会归档在这里，保留原始结果与人工复核状态，可追溯、可导出。"
      />
      <EvidenceClient brands={brands} tasks={tasks} />
    </div>
  );
}
