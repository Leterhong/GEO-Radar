import { prisma } from "@/server/db/client";
import { requireWorkspace } from "@/server/auth/guard";
import { PageHeader } from "@/components/shared/kpi-card";
import { QuestionsManager } from "@/components/questions/questions-manager";

export const dynamic = "force-dynamic";

export default async function QuestionsPage() {
  const { workspaceId } = await requireWorkspace();
  const [sets, questions] = await Promise.all([
    prisma.questionSet.findMany({
      where: { workspaceId, archivedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        versions: { orderBy: { version: "desc" }, take: 1, select: { version: true } },
        _count: { select: { questions: true, tasks: true } },
      },
    }),
    prisma.question.findMany({
      where: { workspaceId },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      include: { questionSet: { select: { id: true, name: true } } },
      take: 500,
    }),
  ]);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="问题集"
        description="维护要追踪的搜索问题。问题按问题集组织，可在搜索实验室中按集合或按选择执行真实搜索。"
      />
      <QuestionsManager
        initialSets={sets.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          currentVersion: s.currentVersion,
          latestVersion: s.versions[0]?.version ?? s.currentVersion,
          questionCount: s._count.questions,
          taskCount: s._count.tasks,
        }))}
        initialQuestions={questions.map((q) => ({
          id: q.id,
          text: q.text,
          questionSetId: q.questionSetId,
          questionSetName: q.questionSet.name,
          category: q.category,
          priority: q.priority,
          enabled: q.enabled,
          version: q.version,
          createdAt: q.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
