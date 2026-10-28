import { prisma } from "@/server/db/client";
import { withAuth, apiFail } from "@/server/api/helpers";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


type Params = { params: { conversationId: string; runId: string } };

/**
 * 确认保存证据：对话搜索在执行时已将结果与证据写入证据库（关联当前用户/工作空间/问题/任务）。
 * 本接口返回本次运行对应的证据清单与真实保存状态，供前端展示确认信息。
 */
export async function POST(_request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId }) => {
    const run = await prisma.conversationRun.findFirst({
      where: { id: params.runId, conversationId: params.conversationId, conversation: { workspaceId } },
    });
    if (!run) return apiFail(404, "NOT_FOUND", "执行记录不存在或不属于当前会话。");
    if (!run.searchTaskId) return apiFail(400, "NO_SEARCH", "本次运行没有搜索阶段，无证据可保存。");
    const evidence = await prisma.evidence.findMany({
      where: { taskId: run.searchTaskId, workspaceId },
      orderBy: { collectedAt: "desc" },
      select: { id: true, title: true, url: true, domain: true, mentionStatus: true, createdAt: true },
    });
    return NextResponse.json({
      ok: true,
      data: {
        saved: evidence.length,
        message:
          evidence.length > 0
            ? `本次搜索的 ${evidence.length} 条结果已在执行时保存到证据库（可复核、可导出）。`
            : "本次搜索没有结果，证据库中没有新增记录。",
        evidence,
      },
    });
  });
}
