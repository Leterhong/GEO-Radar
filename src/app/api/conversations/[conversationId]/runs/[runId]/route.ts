import { prisma } from "@/server/db/client";
import { withAuth, apiFail } from "@/server/api/helpers";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


type Params = { params: { conversationId: string; runId: string } };

/** 轮询单个 Run 的真实状态：阶段、消息、来源与错误。 */
export async function GET(_request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId }) => {
    const run = await prisma.conversationRun.findFirst({
      where: { id: params.runId, conversationId: params.conversationId, conversation: { workspaceId } },
      include: { assistantMessage: true },
    });
    if (!run) return apiFail(404, "NOT_FOUND", "执行记录不存在或不属于当前会话。");
    const sources = await prisma.searchSourceReference.findMany({
      where: { runId: run.id },
      orderBy: { citationIndex: "asc" },
      include: {
        searchResult: {
          select: { id: true, title: true, url: true, domain: true, snippet: true, publishedAt: true },
        },
      },
    });
    const evidenceIds = run.searchTaskId
      ? await prisma.evidence.findMany({
          where: { taskId: run.searchTaskId },
          select: { id: true, resultId: true },
        })
      : [];
    return {
      run: {
        id: run.id,
        mode: run.mode,
        status: run.status,
        stage: run.stage,
        searchTaskId: run.searchTaskId,
        searchError: run.searchError,
        modelError: run.modelError,
        modelProvider: run.modelProvider,
        modelName: run.modelName,
        errorCode: run.errorCode,
        promptTokens: run.promptTokens,
        completionTokens: run.completionTokens,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        assistantMessage: run.assistantMessage
          ? { id: run.assistantMessage.id, content: run.assistantMessage.content, status: run.assistantMessage.status }
          : null,
      },
      sources: sources.map((s) => ({
        citationIndex: s.citationIndex,
        resultId: s.searchResult.id,
        title: s.searchResult.title,
        url: s.searchResult.url,
        domain: s.searchResult.domain,
        snippet: s.searchResult.snippet,
        publishedAt: s.searchResult.publishedAt,
      })),
      evidenceCount: evidenceIds.length,
    };
  });
}
