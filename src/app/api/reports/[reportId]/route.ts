import { prisma } from "@/server/db/client";
import { withAuth, parseBody, apiFail } from "@/server/api/helpers";
import { getReportOrThrow, ReportError } from "@/server/services/analysis/report-service";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Params = { params: { reportId: string } };

const patchSchema = z.object({ title: z.string().trim().min(1).max(150) });

export async function GET(_request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId }) => {
    try {
      const report = await getReportOrThrow(workspaceId, params.reportId);
      return {
        report: {
          id: report.id,
          title: report.title,
          kind: report.kind,
          version: report.version,
          markdown: report.markdown,
          snapshot: report.snapshot,
          generatedAt: report.generatedAt.toISOString(),
          analysisTaskId: report.analysisTaskId,
          searchTaskId: report.searchTaskId,
          baselineTaskId: report.baselineTaskId,
          retestTaskId: report.retestTaskId,
          brandName: report.brand?.name ?? null,
        },
      };
    } catch (error) {
      if (error instanceof ReportError) return apiFail(404, error.code, error.message);
      throw error;
    }
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId }) => {
    const existing = await prisma.report.findFirst({ where: { id: params.reportId, workspaceId } });
    if (!existing) return apiFail(404, "NOT_FOUND", "报告不存在或不属于当前工作空间。");
    const body = await parseBody(request, patchSchema);
    const updated = await prisma.report.update({ where: { id: existing.id }, data: { title: body.title } });
    return NextResponse.json({ ok: true, data: { id: updated.id, title: updated.title } });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId }) => {
    const existing = await prisma.report.findFirst({ where: { id: params.reportId, workspaceId } });
    if (!existing) return apiFail(404, "NOT_FOUND", "报告不存在或不属于当前工作空间。");
    await prisma.report.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true, data: { deleted: true } });
  });
}
