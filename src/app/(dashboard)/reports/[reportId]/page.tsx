import { notFound } from "next/navigation";
import { requireWorkspace } from "@/server/auth/guard";
import { getReportOrThrow, getReportSnapshot } from "@/server/services/analysis/report-service";
import { getCollectionSnapshot, isCollectionReportSnapshot } from "@/server/services/collection-report-service";
import { PageHeader } from "@/components/shared/kpi-card";
import { Markdown } from "@/components/chat/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CollectionReportView } from "@/components/reports/collection-report-view";
import { formatDate } from "@/lib/utils";
import { Download, FileSpreadsheet, FileText, ArrowLeft, ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ReportDetailPage({ params }: { params: { reportId: string } }) {
  const { workspaceId } = await requireWorkspace();
  let report;
  try {
    report = await getReportOrThrow(workspaceId, params.reportId);
  } catch {
    notFound();
  }

  const rawSnapshot = report.snapshot;
  const isCollection = report.kind !== "ANALYSIS" && isCollectionReportSnapshot(rawSnapshot);

  if (isCollection) {
    const snapshot = getCollectionSnapshot(report);
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title={report.title}
          description={`${snapshot.brand?.name ?? "—"} · 生成于 ${formatDate(report.generatedAt)} · 快照版本 v${report.version} · 数据版本 ${snapshot.dataVersion.reportedRuleVersion}`}
          actions={
            <>
              <Button variant="outline" size="sm" asChild>
                <a href="/reports">
                  <ArrowLeft className="mr-1 h-3.5 w-3.5" /> 返回列表
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/reports/${report.id}/export?format=html`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1 h-3.5 w-3.5" /> HTML
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/reports/${report.id}/export?format=md`}>
                  <Download className="mr-1 h-3.5 w-3.5" /> Markdown
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/reports/${report.id}/export?format=csv`}>
                  <FileSpreadsheet className="mr-1 h-3.5 w-3.5" /> 指标 CSV
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/reports/${report.id}/export?format=questions-csv`}>
                  <FileSpreadsheet className="mr-1 h-3.5 w-3.5" /> 问题 CSV
                </a>
              </Button>
              <Button size="sm" asChild>
                <a href={`/api/reports/${report.id}/export?format=evidence-csv`}>
                  <FileText className="mr-1 h-3.5 w-3.5" /> 证据 CSV
                </a>
              </Button>
            </>
          }
        />
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px] text-tertiary">
          <Badge variant={report.kind === "COMPARISON" ? "info" : "success"}>
            {report.kind === "COMPARISON" ? "两轮对比报告" : "搜索证据报告"}
          </Badge>
          <span>统计窗口：{snapshot.collection.dataWindowFrom.slice(0, 10)} ~ {snapshot.collection.dataWindowTo.slice(0, 10)}</span>
          <span>·</span>
          <span>有效问题：{snapshot.collection.validQuestions}</span>
          <span>·</span>
          <span>问题集版本：v{snapshot.task.questionSetVersion ?? "未知"}</span>
          {snapshot.task.baselineTaskId ? (
            <>
              <span>·</span>
              <a href={`/search-lab/${snapshot.task.baselineTaskId}`} className="text-primary hover:underline">
                基线任务
              </a>
            </>
          ) : null}
        </div>
        <CollectionReportView snapshot={snapshot} />
        <p className="mt-4 text-[11px] leading-relaxed text-quaternary">
          报告内容与指标为生成时刻的快照；后续证据复核、品牌配置或问题集修改不会改写本报告。如需最新结果，请重新生成报告。
        </p>
      </div>
    );
  }

  const snapshot = getReportSnapshot(report);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={report.title}
        description={`${report.brand?.name ?? "—"} · 生成于 ${formatDate(report.generatedAt)} · 快照版本 v${report.version}`}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <a href="/reports">
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> 返回列表
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/reports/${report.id}/export?format=csv`}>
                <FileSpreadsheet className="mr-1 h-3.5 w-3.5" /> 导出指标 CSV
              </a>
            </Button>
            <Button size="sm" asChild>
              <a href={`/api/reports/${report.id}/export?format=md`}>
                <Download className="mr-1 h-3.5 w-3.5" /> 导出 Markdown
              </a>
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px] text-tertiary">
        <Badge variant="info">快照</Badge>
        <span>统计窗口：{snapshot.dataWindow.from.slice(0, 10)} ~ {snapshot.dataWindow.to.slice(0, 10)}</span>
        <span>·</span>
        <span>数据来源：{snapshot.scope.dataSource}</span>
        <span>·</span>
        <span>有效回答：{snapshot.scope.validAnswers}</span>
      </div>

      <article className="rounded-xl border border-border bg-card px-6 py-5">
        <Markdown content={report.markdown} />
      </article>

      <p className="mt-4 text-[11px] leading-relaxed text-quaternary">
        报告内容与指标为生成时刻的快照；后续对话、证据或品牌配置变更不会改写本报告。如需最新结果，请重新执行分析并生成新报告。
      </p>
    </div>
  );
}
