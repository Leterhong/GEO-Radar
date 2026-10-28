import { requireWorkspace } from "@/server/auth/guard";
import { prisma } from "@/server/db/client";
import { notFound } from "next/navigation";
import { SearchTaskDetail } from "@/components/search-lab/search-task-detail";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({ params }: { params: { taskId: string } }) {
  const { workspaceId } = await requireWorkspace();
  const task = await prisma.searchTask.findFirst({
    where: { id: params.taskId, workspaceId },
    include: {
      brand: { select: { id: true, name: true } },
      creator: { select: { name: true } },
      questionSet: { select: { id: true, name: true } },
    },
  });
  if (!task) notFound();
  const [items, results, snapshots, retests] = await Promise.all([
    prisma.searchTaskItem.findMany({
      where: { taskId: task.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.searchResult.findMany({
      where: { taskId: task.id },
      orderBy: [{ itemId: "asc" }, { position: "asc" }],
      include: {
        evidence: {
          select: {
            id: true,
            mentionStatus: true,
            pageType: true,
            sourceRole: true,
            brandMatchBasis: true,
            officialDomainMatch: true,
          },
        },
      },
      take: 800,
    }),
    prisma.analysisSnapshot.findMany({
      where: { workspaceId, taskId: task.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, kind: true, ruleVersion: true, evidenceCount: true, truncated: true, createdAt: true },
    }),
    prisma.searchTask.findMany({
      where: { workspaceId, baselineTaskId: task.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, status: true, finishedAt: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <SearchTaskDetail
        task={{
          id: task.id,
          name: task.name,
          description: task.description,
          brandId: task.brand?.id ?? null,
          brandName: task.brand?.name ?? null,
          executionMode: task.executionMode,
          provider: task.provider,
          status: task.status,
          totalItems: task.totalItems,
          successItems: task.successItems,
          failedItems: task.failedItems,
          emptyItems: task.emptyItems,
          parseErrorItems: task.parseErrorItems,
          failureReason: task.failureReason,
          questionSetName: task.questionSet?.name ?? null,
          questionSetVersion: task.questionSetVersion,
          baselineTaskId: task.baselineTaskId,
          source: task.source,
          params: task.params,
          startedAt: task.startedAt?.toISOString() ?? null,
          finishedAt: task.finishedAt?.toISOString() ?? null,
          createdAt: task.createdAt.toISOString(),
          creatorName: task.creator.name,
        }}
        initialItems={items.map((i) => ({
          id: i.id,
          questionText: i.questionText,
          category: i.categorySnapshot,
          status: i.status,
          attempts: i.attempts,
          error: i.error,
          errorCategory: i.errorCategory,
          providerRequestId: i.providerRequestId,
          durationMs: i.durationMs,
          resultCount: i.resultCount,
          parseErrorCount: i.parseErrorCount,
          executedAt: i.executedAt?.toISOString() ?? null,
        }))}
        initialResults={results.map((r) => {
          const evidence = r.evidence[0];
          return {
            id: r.id,
            evidenceId: evidence?.id ?? null,
            itemId: r.itemId,
            position: r.position,
            title: r.title,
            url: r.url,
            domain: r.domain,
            snippet: r.snippet,
            publishedAt: r.publishedAt,
            mentionStatus: evidence?.mentionStatus ?? "PENDING_REVIEW",
            pageType: evidence?.pageType ?? "UNKNOWN",
            sourceRole: evidence?.sourceRole ?? "UNKNOWN",
            brandMatchBasis: evidence?.brandMatchBasis ?? [],
            officialDomainMatch: evidence?.officialDomainMatch ?? false,
            isMock: r.isMock,
          };
        })}
        initialSnapshots={snapshots.map((s) => ({
          id: s.id,
          kind: s.kind,
          ruleVersion: s.ruleVersion,
          evidenceCount: s.evidenceCount,
          truncated: s.truncated,
          createdAt: s.createdAt.toISOString(),
        }))}
        retests={retests.map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          finishedAt: r.finishedAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
