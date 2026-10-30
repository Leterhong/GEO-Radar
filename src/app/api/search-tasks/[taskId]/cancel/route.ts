import { apiFail, handleApiError, withTasksRunAuth } from "@/server/api/helpers";
import { cancelSearchTask, SearchExecutionError } from "@/server/services/search-execution";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


type Params = { params: { taskId: string } };

export async function POST(_request: Request, { params }: Params) {
  try {
    return await withTasksRunAuth(async ({ workspaceId, user }) => {
      try {
        await cancelSearchTask(params.taskId, workspaceId, user.id);
        return NextResponse.json({ ok: true, data: { accepted: true } });
      } catch (error) {
        if (error instanceof SearchExecutionError) {
          return apiFail(409, error.code, error.message);
        }
        throw error;
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}
