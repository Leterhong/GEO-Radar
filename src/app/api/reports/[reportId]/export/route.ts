import { apiFail, withReadAuth } from "@/server/api/helpers";
import {
  getReportOrThrow,
  getReportSnapshot,
  renderMetricsCsv,
  ReportError,
} from "@/server/services/analysis/report-service";
import {
  getCollectionSnapshot,
  isCollectionReportSnapshot,
  renderCollectionEvidenceCsv,
  renderCollectionHtml,
  renderCollectionMarkdown,
  renderCollectionMetricsCsv,
  renderCollectionQuestionsCsv,
} from "@/server/services/collection-report-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Params = { params: { reportId: string } };

/**
 * 导出：
 * - 分析报告：md / csv
 * - 搜索证据报告：md / html / csv（指标）/ questions-csv / evidence-csv
 */
export async function GET(request: Request, { params }: Params) {
  return withReadAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "md").toLowerCase();
    try {
      const report = await getReportOrThrow(workspaceId, params.reportId);
      const safeName = report.title.replace(/[^\p{L}\p{N}\-_ ]/gu, "").slice(0, 60) || "georadar-report";
      const rawSnapshot = report.snapshot;
      const collectionSnapshot = isCollectionReportSnapshot(rawSnapshot) ? getCollectionSnapshot(report) : null;

      if (collectionSnapshot) {
        if (format === "md") {
          return new NextResponse(renderCollectionMarkdown(collectionSnapshot), {
            headers: {
              "Content-Type": "text/markdown; charset=utf-8",
              "Content-Disposition": `attachment; filename="${encodeURIComponent(safeName)}.md"`,
            },
          });
        }
        if (format === "html") {
          return new NextResponse(renderCollectionHtml(collectionSnapshot), {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Content-Disposition": `inline; filename="${encodeURIComponent(safeName)}.html"`,
            },
          });
        }
        if (format === "csv") {
          return new NextResponse(renderCollectionMetricsCsv(collectionSnapshot), {
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": `attachment; filename="${encodeURIComponent(safeName)}-metrics.csv"`,
            },
          });
        }
        if (format === "questions-csv") {
          return new NextResponse(renderCollectionQuestionsCsv(collectionSnapshot), {
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": `attachment; filename="${encodeURIComponent(safeName)}-questions.csv"`,
            },
          });
        }
        if (format === "evidence-csv") {
          return new NextResponse(renderCollectionEvidenceCsv(collectionSnapshot), {
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": `attachment; filename="${encodeURIComponent(safeName)}-evidence.csv"`,
            },
          });
        }
        return apiFail(400, "INVALID_FORMAT", "搜索证据报告支持 format=md / html / csv / questions-csv / evidence-csv");
      }

      if (format === "csv") {
        const csv = renderMetricsCsv(getReportSnapshot(report));
        return new NextResponse(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${encodeURIComponent(safeName)}-metrics.csv"`,
          },
        });
      }
      if (format === "md") {
        return new NextResponse(report.markdown, {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": `attachment; filename="${encodeURIComponent(safeName)}.md"`,
          },
        });
      }
      return apiFail(400, "INVALID_FORMAT", "分析报告支持 format=md 或 csv");
    } catch (error) {
      if (error instanceof ReportError) return apiFail(404, error.code, error.message);
      throw error;
    }
  });
}
