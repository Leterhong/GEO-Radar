import { prisma } from "@/server/db/client";
import { withAuth, parseBody, apiFail } from "@/server/api/helpers";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Params = { params: { eventId: string } };

const updateSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  occurredAt: z.string().optional(),
  contentChanged: z.string().trim().max(2000).optional(),
  pageUrls: z.array(z.string().trim().max(500)).max(20).optional(),
  note: z.string().trim().max(1000).optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId }) => {
    const existing = await prisma.optimizationEvent.findFirst({ where: { id: params.eventId, workspaceId } });
    if (!existing) return apiFail(404, "NOT_FOUND", "事件不存在或不属于当前工作空间。");
    const body = await parseBody(request, updateSchema);
    const occurredAt = body.occurredAt
      ? body.occurredAt.length === 10
        ? new Date(`${body.occurredAt}T00:00:00.000Z`)
        : new Date(body.occurredAt)
      : undefined;
    if (occurredAt && Number.isNaN(occurredAt.getTime())) return apiFail(400, "INVALID_DATE", "事件时间格式不正确。");
    const event = await prisma.optimizationEvent.update({
      where: { id: existing.id },
      data: {
        name: body.name,
        occurredAt,
        contentChanged: body.contentChanged !== undefined ? body.contentChanged || null : undefined,
        pageUrls: body.pageUrls,
        note: body.note !== undefined ? body.note || null : undefined,
      },
    });
    return NextResponse.json({ ok: true, data: event });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId }) => {
    const existing = await prisma.optimizationEvent.findFirst({ where: { id: params.eventId, workspaceId } });
    if (!existing) return apiFail(404, "NOT_FOUND", "事件不存在或不属于当前工作空间。");
    await prisma.optimizationEvent.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true, data: { deleted: true } });
  });
}
