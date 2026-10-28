import { prisma } from "@/server/db/client";
import { withAuth, apiFail, handleApiError } from "@/server/api/helpers";
import { startSearchTask, SearchExecutionError } from "@/server/services/search-execution";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


type Params = { params: { taskId: string } };

/**
 * 启动执行（必须由用户主动确认后调用）。
 * 执行为异步：立即返回，进度通过 GET /api/search-tasks/[taskId] 轮询。
 * 只有此接口会触发真实的供应商请求。
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    return await withAuth(async ({ workspaceId, user }) => {
      // 先做一次同步状态校验，快速失败
      const task = await prisma.searchTask.findFirst({ where: { id: params.taskId, workspaceId } });
      if (!task) return apiFail(404, "NOT_FOUND", "任务不存在或不属于当前工作空间。");
      if (task.status !== "QUEUED") {
        return apiFail(409, "INVALID_TASK_STATE", `任务当前状态为 ${task.status}，无法启动。`);
      }
      // 异步执行：不阻塞 HTTP 响应；错误记录在任务状态中
      void startSearchTask(task.id, workspaceId, user.id).catch((error) => {
        console.error("[search-task] 执行异常:", error instanceof Error ? error.message : error);
      });
      return NextResponse.json({ ok: true, data: { taskId: task.id, accepted: true } });
    });
  } catch (error) {
    if (error instanceof SearchExecutionError) {
      return apiFail(400, error.code, error.message);
    }
    return handleApiError(error);
  }
}
