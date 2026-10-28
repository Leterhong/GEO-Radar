import { prisma } from "@/server/db/client";
import { withAuth, apiFail } from "@/server/api/helpers";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


type Params = { params: { taskId: string } };

/** 任务结果列表（含证据提及状态）。 */
export async function GET(request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    const itemId = url.searchParams.get("itemId") ?? undefined;
    const task = await prisma.searchTask.findFirst({ where: { id: params.taskId, workspaceId } });
    if (!task) return apiFail(404, "NOT_FOUND", "任务不存在或不属于当前工作空间。");
    const results = await prisma.searchResult.findMany({
      where: { taskId: task.id, ...(itemId ? { itemId } : {}) },
      orderBy: [{ itemId: "asc" }, { position: "asc" }],
      include: {
        evidence: {
          select: {
            id: true,
            mentionStatus: true,
            matchedTerms: true,
            competitorMatches: true,
            pageType: true,
            sourceRole: true,
            brandMatchBasis: true,
            officialDomainMatch: true,
          },
        },
      },
      take: 500,
    });
    return { results };
  });
}
