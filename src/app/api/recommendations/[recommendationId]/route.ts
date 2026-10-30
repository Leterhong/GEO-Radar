import { prisma } from "@/server/db/client";
import { withAuth, parseBody, apiFail } from "@/server/api/helpers";
import { optimizationTaskUpdateSchema } from "@/lib/validation/schemas";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


type Params = { params: { recommendationId: string } };

export async function PATCH(request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId }) => {
    const existing = await prisma.optimizationTask.findFirst({
      where: { id: params.recommendationId, workspaceId },
    });
    if (!existing) return apiFail(404, "NOT_FOUND", "优化任务不存在或不属于当前工作空间。");
    const body = await parseBody(request, optimizationTaskUpdateSchema);
    const task = await prisma.optimizationTask.update({
      where: { id: existing.id },
      data: {
        status: body.status,
        priority: body.priority,
        title: body.title,
        description: body.description,
        pageUrl: body.pageUrl !== undefined ? body.pageUrl || null : undefined,
        assignee: body.assignee,
        dueDate: body.dueDate !== undefined ? (body.dueDate ? new Date(body.dueDate) : undefined) : undefined,
        completedAt: body.status === "DONE" ? new Date() : undefined,
      },
    });
    return NextResponse.json({ ok: true, data: task });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId }) => {
    const existing = await prisma.optimizationTask.findFirst({
      where: { id: params.recommendationId, workspaceId },
    });
    if (!existing) return apiFail(404, "NOT_FOUND", "优化任务不存在或不属于当前工作空间。");
    await prisma.optimizationTask.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true, data: {} });
  });
}
