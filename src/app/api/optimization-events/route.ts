import { prisma } from "@/server/db/client";
import { withAuth, parseBody, apiFail, writeAuditLog } from "@/server/api/helpers";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  brandId: z.string().optional(),
  name: z.string().trim().min(1, "请填写事件名称").max(150),
  occurredAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  contentChanged: z.string().trim().max(2000).optional(),
  pageUrls: z.array(z.string().trim().max(500)).max(20).optional(),
  note: z.string().trim().max(1000).optional(),
  baselineTaskId: z.string().optional(),
  retestTaskId: z.string().optional(),
});

export async function GET(request: Request) {
  return withAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    const brandId = url.searchParams.get("brandId") ?? undefined;
    const events = await prisma.optimizationEvent.findMany({
      where: { workspaceId, ...(brandId ? { brandId } : {}) },
      orderBy: { occurredAt: "desc" },
      take: 100,
    });
    return { events };
  });
}

export async function POST(request: Request) {
  return withAuth(async ({ workspaceId, user }) => {
    const body = await parseBody(request, createSchema);
    if (body.brandId) {
      const brand = await prisma.brand.findFirst({ where: { id: body.brandId, workspaceId } });
      if (!brand) return apiFail(400, "BRAND_NOT_FOUND", "品牌不存在或不属于当前工作空间。");
    }
    for (const taskId of [body.baselineTaskId, body.retestTaskId]) {
      if (!taskId) continue;
      const task = await prisma.searchTask.findFirst({ where: { id: taskId, workspaceId }, select: { id: true } });
      if (!task) return apiFail(400, "TASK_NOT_FOUND", "关联任务不存在或不属于当前工作空间。");
    }
    const occurredAt = body.occurredAt.length === 10 ? new Date(`${body.occurredAt}T00:00:00.000Z`) : new Date(body.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) return apiFail(400, "INVALID_DATE", "事件时间格式不正确。");
    const event = await prisma.optimizationEvent.create({
      data: {
        workspaceId,
        brandId: body.brandId || undefined,
        name: body.name,
        occurredAt,
        contentChanged: body.contentChanged || undefined,
        pageUrls: body.pageUrls ?? [],
        note: body.note || undefined,
        baselineTaskId: body.baselineTaskId || undefined,
        retestTaskId: body.retestTaskId || undefined,
        createdById: user.id,
      },
    });
    await writeAuditLog({
      workspaceId,
      userId: user.id,
      action: "OPTIMIZATION_EVENT_CREATED",
      targetType: "OptimizationEvent",
      targetId: event.id,
    });
    return NextResponse.json({ ok: true, data: event });
  });
}
