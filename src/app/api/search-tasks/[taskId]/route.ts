import { prisma } from "@/server/db/client";
import { apiFail, withReadAuth } from "@/server/api/helpers";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


type Params = { params: { taskId: string } };

export async function GET(_request: Request, { params }: Params) {
  return withReadAuth(async ({ workspaceId }) => {
    const task = await prisma.searchTask.findFirst({
      where: { id: params.taskId, workspaceId },
      include: {
        brand: { select: { id: true, name: true } },
        creator: { select: { name: true } },
      },
    });
    if (!task) return apiFail(404, "NOT_FOUND", "任务不存在或不属于当前工作空间。");
    const items = await prisma.searchTaskItem.findMany({
      where: { taskId: task.id },
      orderBy: { createdAt: "asc" },
    });
    return { task, items };
  });
}
