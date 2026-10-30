import { prisma } from "@/server/db/client";
import { apiFail, withReadAuth } from "@/server/api/helpers";
import { parseVersionQuestions } from "@/server/services/question-set-service";

export const dynamic = "force-dynamic";

type Params = { params: { questionSetId: string } };

/** 问题集版本列表：展示版本号、问题数量与快照内容（不可变）。 */
export async function GET(_request: Request, { params }: Params) {
  return withReadAuth(async ({ workspaceId }) => {
    const set = await prisma.questionSet.findFirst({
      where: { id: params.questionSetId, workspaceId },
      select: { id: true, name: true, currentVersion: true },
    });
    if (!set) return apiFail(404, "NOT_FOUND", "问题集不存在或不属于当前工作空间。");
    const versions = await prisma.questionSetVersion.findMany({
      where: { questionSetId: set.id, workspaceId },
      orderBy: { version: "desc" },
      take: 100,
    });
    return {
      questionSet: set,
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        name: v.name,
        description: v.description,
        questionCount: v.questionCount,
        enabledCount: v.enabledCount,
        note: v.note,
        createdAt: v.createdAt,
        questions: parseVersionQuestions(v),
      })),
    };
  });
}
