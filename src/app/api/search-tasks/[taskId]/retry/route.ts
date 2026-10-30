import { apiFail, handleApiError, withTasksRunAuth } from "@/server/api/helpers";
import { retryFailedItems, SearchExecutionError } from "@/server/services/search-execution";
import { NextResponse } from "next/server";

type Params = { params: { taskId: string } };

export async function POST(_request: Request, { params }: Params) {
  try {
    return await withTasksRunAuth(async ({ workspaceId, user }) => {
      // 重试同样为异步执行，进度通过任务详情轮询
      const task = await prisma.searchTask.findFirst({ where: { id: params.taskId, workspaceId } });
      if (!task) return apiFail(404, "NOT_FOUND", "任务不存在或不属于当前工作空间。");
      void retryFailedItems(task.id, workspaceId, user.id).catch((error) => {
        console.error("[search-task] 重试执行异常:", error instanceof Error ? error.message : error);
      });
      return NextResponse.json({ ok: true, data: { accepted: true } });
    });
  } catch (error) {
    if (error instanceof SearchExecutionError) {
      return apiFail(400, error.code, error.message);
    }
    return handleApiError(error);
  }
}

import { prisma } from "@/server/db/client";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";

