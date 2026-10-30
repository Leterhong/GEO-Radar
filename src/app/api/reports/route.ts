import { prisma } from "@/server/db/client";
import { parseBody, apiFail, withReadAuth, withReportsWriteAuth } from "@/server/api/helpers";
import { createReport, ReportError } from "@/server/services/analysis/report-service";
import { createCollectionReport, CollectionReportError } from "@/server/services/collection-report-service";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z
  .object({
    analysisTaskId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    compareTaskId: z.string().min(1).optional(),
    title: z.string().trim().max(150).optional(),
  })
  .refine((value) => Boolean(value.analysisTaskId) || Boolean(value.taskId), {
    message: "请提供 analysisTaskId 或 taskId",
  });

export async function GET() {
  return withReadAuth(async ({ workspaceId }) => {
    const reports = await prisma.report.findMany({
      where: { workspaceId },
      orderBy: { generatedAt: "desc" },
      take: 100,
      include: { brand: { select: { name: true } } },
    });
    return {
      reports: reports.map((r) => ({
        id: r.id,
        title: r.title,
        kind: r.kind,
        brandName: r.brand?.name ?? null,
        searchTaskId: r.searchTaskId,
        baselineTaskId: r.baselineTaskId,
        retestTaskId: r.retestTaskId,
        version: r.version,
        generatedAt: r.generatedAt.toISOString(),
        dataWindowFrom: r.dataWindowFrom?.toISOString() ?? null,
        dataWindowTo: r.dataWindowTo?.toISOString() ?? null,
      })),
    };
  });
}

/**
 * 生成报告：
 * - analysisTaskId：原有 answer 级分析报告
 * - taskId：以真实搜索取证为中心的 GEO 报告（可附 compareTaskId 生成两轮对比）
 * 报告保存快照，不受后续数据变化影响。
 */
export async function POST(request: Request) {
  return withReportsWriteAuth(async ({ workspaceId, user }) => {
    const body = await parseBody(request, createSchema);
    if (body.taskId) {
      try {
        const report = await createCollectionReport(workspaceId, user.id, {
          taskId: body.taskId,
          compareTaskId: body.compareTaskId,
          title: body.title,
        });
        return NextResponse.json({
          ok: true,
          data: { id: report.id, title: report.title, kind: report.kind },
        });
      } catch (error) {
        if (error instanceof CollectionReportError) return apiFail(400, error.code, error.message);
        throw error;
      }
    }
    try {
      const report = await createReport(workspaceId, user.id, body.analysisTaskId as string, body.title);
      return NextResponse.json({ ok: true, data: { id: report.id, title: report.title, kind: report.kind } });
    } catch (error) {
      if (error instanceof ReportError) return apiFail(400, error.code, error.message);
      throw error;
    }
  });
}
