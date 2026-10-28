import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InlineAlert, SectionTitle } from "@/components/shared/kpi-card";
import { matrixCellStateLabel } from "@/server/services/matrix-service";
import type { CollectionReportSnapshot } from "@/server/services/collection-report-service";
import { ArrowUpRight, ExternalLink } from "lucide-react";

function pct(value: number | null): string {
  return value === null ? "不可计算" : `${(value * 100).toFixed(1)}%`;
}

function deltaPct(value: number | null): string {
  if (value === null) return "无法计算";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)} 个百分点`;
}

export function CollectionReportView({ snapshot }: { snapshot: CollectionReportSnapshot }) {
  const comparison = snapshot.comparison;
  return (
    <div className="space-y-4">
      {snapshot.collection.isMock ? (
        <InlineAlert tone="warning" title="模拟数据报告">
          本报告基于模拟任务生成，仅用于流程验证，不代表真实搜索表现。
        </InlineAlert>
      ) : null}

      <Card>
        <CardContent className="p-5">
          <SectionTitle title="1. 报告基本信息" description={`数据版本 ${snapshot.dataVersion.reportedRuleVersion}`} />
          <dl className="grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="text-quaternary">生成时间</dt><dd>{new Date(snapshot.generatedAt).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}</dd></div>
            <div><dt className="text-quaternary">任务</dt><dd>{snapshot.task.name}</dd></div>
            <div><dt className="text-quaternary">任务状态 / 模式</dt><dd>{snapshot.task.status} · {snapshot.task.executionMode === "MOCK" ? "模拟" : "真实"}</dd></div>
            <div><dt className="text-quaternary">指标版本</dt><dd className="font-mono text-[11px]">{snapshot.dataVersion.metricsVersion}</dd></div>
            <div><dt className="text-quaternary">证据规则版本</dt><dd className="font-mono text-[11px]">{snapshot.dataVersion.evidenceRuleVersion}</dd></div>
            <div><dt className="text-quaternary">URL 规范化版本</dt><dd className="font-mono text-[11px]">{snapshot.dataVersion.urlNormalizationVersion}</dd></div>
          </dl>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <SectionTitle title="2. 目标品牌与竞品" />
            <p className="text-[13px] font-medium">{snapshot.brand?.name ?? "未指定"}</p>
            <p className="mt-1 text-[11px] text-tertiary">
              官网：{snapshot.brand?.websiteDomain ?? "未配置"}
              {snapshot.brand?.officialSubdomains.length ? ` · 官方子域：${snapshot.brand.officialSubdomains.join("、")}` : ""}
            </p>
            <p className="mt-1 text-[11px] text-tertiary">
              竞品：{snapshot.competitors.length > 0 ? snapshot.competitors.map((c) => c.name).join("、") : "未配置"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <SectionTitle title="3. 采集时间范围与 4. 问题集版本" />
            <p className="text-[11px] text-tertiary">
              {snapshot.collection.dataWindowFrom.slice(0, 19).replace("T", " ")} ~ {snapshot.collection.dataWindowTo.slice(0, 19).replace("T", " ")}
            </p>
            <p className="mt-1 text-[11px] text-tertiary">
              问题集：{snapshot.task.questionSetName ?? "—"} · v{snapshot.task.questionSetVersion ?? "未知"} · {snapshot.collection.totalQuestions} 个问题
            </p>
            <p className="mt-1 text-[11px] text-tertiary">
              耗时：{snapshot.collection.durationMs === null ? "—" : `${Math.round(snapshot.collection.durationMs / 1000)} 秒`} · 创建于 {snapshot.task.createdAt.slice(0, 19).replace("T", " ")}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5">
          <SectionTitle title="5. 采集成功率与有效样本" description="失败、取消、空结果、未执行不计入指标分母。" />
          <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-md bg-surface-muted px-3 py-2">问题总数<br /><span className="text-lg font-semibold">{snapshot.collection.totalQuestions}</span></div>
            <div className="rounded-md bg-surface-muted px-3 py-2">成功<br /><span className="text-lg font-semibold text-success">{snapshot.collection.successItems}</span></div>
            <div className="rounded-md bg-surface-muted px-3 py-2">失败<br /><span className="text-lg font-semibold text-destructive">{snapshot.collection.failedItems}</span></div>
            <div className="rounded-md bg-surface-muted px-3 py-2">空结果<br /><span className="text-lg font-semibold text-warning">{snapshot.collection.emptyItems}</span></div>
            <div className="rounded-md bg-surface-muted px-3 py-2">有效问题<br /><span className="text-lg font-semibold">{snapshot.collection.validQuestions}</span></div>
            <div className="rounded-md bg-surface-muted px-3 py-2">成功率<br /><span className="text-lg font-semibold">{pct(snapshot.collection.successRate)}</span></div>
          </div>
          {snapshot.task.failureReason ? <p className="mt-2 text-[11px] text-destructive">任务失败原因：{snapshot.task.failureReason}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <SectionTitle title="6. 核心指标及统计口径" description="所有指标展示分子、分母与样本提示；数值由服务端确定性代码计算。" />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {snapshot.metrics
              .filter((metric) => metric.key !== "page_type_distribution")
              .map((metric) => (
                <div key={metric.key} className="rounded-lg border border-border p-3">
                  <p className="text-[12px] text-tertiary">{metric.label}</p>
                  <p className="mt-1 text-[22px] font-semibold leading-none">
                    {metric.notConfigured ? "未配置官网" : metric.insufficient ? "样本不足" : pct(metric.value)}
                  </p>
                  <p className="mt-1 text-[11px] text-quaternary">
                    分子 {metric.numerator} / 分母 {metric.denominator}
                    {metric.smallSample ? " · 样本 < 5" : ""}
                  </p>
                  <p className="mt-1.5 line-clamp-3 text-[10px] leading-relaxed text-quaternary">{metric.definition}</p>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <SectionTitle title="7. 品牌问题矩阵" description="问题 × 实体；失败和空结果有独立状态，不表示为「未发现」。" />
          <div className="overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[260px]">问题</TableHead>
                  <TableHead className="w-24">类别</TableHead>
                  <TableHead className="w-24">问题状态</TableHead>
                  {snapshot.matrix.entities.map((entity) => (
                    <TableHead key={entity.key} className="min-w-[120px]">{entity.name}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.matrix.questions.map((question) => (
                  <TableRow key={question.key}>
                    <TableCell className="text-[12px]">{question.questionText}</TableCell>
                    <TableCell className="text-[11px] text-tertiary">{question.category}</TableCell>
                    <TableCell>
                      <Badge variant={question.state === "FOUND" ? "success" : question.state === "TASK_FAILED" ? "destructive" : "muted"}>
                        {matrixCellStateLabel(question.state as never)}
                      </Badge>
                    </TableCell>
                    {snapshot.matrix.entities.map((entity) => {
                      const cell = question.cells.find((c) => c.entityKey === entity.key);
                      return (
                        <TableCell key={entity.key} className="text-[11px]">
                          {cell ? (
                            <div>
                              <Badge variant={cell.state === "FOUND" ? "success" : cell.state === "TASK_FAILED" ? "destructive" : "muted"}>
                                {matrixCellStateLabel(cell.state as never)}
                              </Badge>
                              <p className="mt-0.5 text-[10px] text-quaternary">
                                {cell.found ? `${cell.pageCount} 页 / ${cell.evidenceCount} 证据` : ""}
                              </p>
                            </div>
                          ) : "—"}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <SectionTitle title="8. 官网页面覆盖情况" />
            <p className="text-[12px]">
              官网：{snapshot.officialCoverage.websiteDomain ?? "未配置"} · 有官网页面的问题 {snapshot.officialCoverage.questionsWithOfficialPage} / {snapshot.collection.validQuestions} · 去重页面 {snapshot.officialCoverage.officialPageCount}
            </p>
            {snapshot.officialCoverage.officialPages.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {snapshot.officialCoverage.officialPages.map((page) => (
                  <li key={page.evidenceId} className="text-[11px]">
                    <a href={page.url} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline">
                      {page.title}
                    </a>
                    <span className="ml-1 text-quaternary">（{page.pageTypeLabel}）</span>
                    <Link href={`/evidence/${page.evidenceId}`} className="ml-1 text-primary hover:underline">证据</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-tertiary">本轮未发现官网页面。</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <SectionTitle title="9. 页面类型分布" description={`去重页面 ${snapshot.pageTypeDistribution.reduce((s, r) => s + r.count, 0)} 个。`} />
            {snapshot.pageTypeDistribution.length === 0 ? (
              <p className="text-[11px] text-tertiary">没有品牌相关页面。</p>
            ) : (
              <div className="space-y-1.5">
                {snapshot.pageTypeDistribution.map((row) => (
                  <div key={row.pageType} className="flex items-center justify-between text-[11px]">
                    <span className="text-secondary-soft">{row.label}</span>
                    <span className="font-mono text-quaternary">{row.count} · {pct(row.share)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5">
          <SectionTitle title="10. 代表性证据及来源链接" description="仅展示品牌/竞品相关证据；完整证据可在任务详情与证据库追溯。" />
          {snapshot.representativeEvidence.length === 0 ? (
            <p className="text-[11px] text-tertiary">没有可展示的证据。</p>
          ) : (
            <div className="space-y-2">
              {snapshot.representativeEvidence.map((ev) => (
                <div key={ev.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <a href={ev.url} target="_blank" rel="noopener noreferrer nofollow" className="text-[12px] font-medium hover:text-primary hover:underline">
                        {ev.title}
                      </a>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-quaternary">{ev.domain}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1">
                      <Badge variant="info">{ev.pageTypeLabel}</Badge>
                      <Badge variant="secondary">{ev.sourceRole === "OFFICIAL" ? "官网" : "第三方"}</Badge>
                    </div>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] text-tertiary">{ev.questionText} · 依据：{ev.matchBasisLabels.join("、") || "—"}</p>
                  <div className="mt-1 flex gap-3 text-[11px]">
                    <Link href={`/evidence/${ev.id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                      证据详情 <ArrowUpRight className="h-3 w-3" />
                    </Link>
                    <a href={ev.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-primary hover:underline">
                      原文 <ExternalLink className="h-3 w-3" />
                    </a>
                    {ev.requestId ? <span className="font-mono text-[10px] text-quaternary">RequestId: {ev.requestId}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <SectionTitle title="11. 历史轮次变化" description="两轮比较基于共同可比问题；总体指标仍按各自有效样本计算。" />
          {!comparison ? (
            <p className="text-[11px] text-tertiary">本报告未关联上一轮任务，不包含轮次变化。</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-4">
                <div className="rounded-md bg-surface-muted px-3 py-2">数据来源：{comparison.baseline.dataSource === "SNAPSHOT" ? "采集快照" : "实时计算"}</div>
                <div className="rounded-md bg-surface-muted px-3 py-2">共同可比问题：{comparison.questions.totalCommon}</div>
                <div className="rounded-md bg-surface-muted px-3 py-2">品牌状态一致性：{pct(comparison.consistency.sameBrandStatusRate)}</div>
                <div className="rounded-md bg-surface-muted px-3 py-2">提升 {comparison.questions.improved.length} · 下降 {comparison.questions.declined.length} · 待复核 {comparison.questions.newlyNeedsReview.length}</div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>指标</TableHead>
                    <TableHead>基线</TableHead>
                    <TableHead>复测</TableHead>
                    <TableHead>变化</TableHead>
                    <TableHead>共同子集变化</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparison.metrics.map((metric) => {
                    const common = comparison.commonSubset.metrics.find((m) => m.key === metric.key);
                    return (
                      <TableRow key={metric.key}>
                        <TableCell className="text-[12px]">{metric.label}</TableCell>
                        <TableCell className="text-[12px]">{pct(metric.baseline.value)}</TableCell>
                        <TableCell className="text-[12px]">{pct(metric.retest.value)}</TableCell>
                        <TableCell className="text-[12px]">{deltaPct(metric.delta)}</TableCell>
                        <TableCell className="text-[12px]">{common ? deltaPct(common.delta) : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <p className="text-[11px] text-tertiary">
                页面变化：新出现 {comparison.pageDiff.newPages.length} · 未再出现 {comparison.pageDiff.disappearedPages.length} · 持续出现 {comparison.pageDiff.persistedPages.length}；无法直接比较的问题 {comparison.questions.uncomparable.length} 个。
              </p>
              {comparison.questions.declined.length > 0 ? (
                <p className="text-[11px] text-destructive">品牌状态下降：{comparison.questions.declined.map((q) => q.questionText).slice(0, 8).join("；")}</p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <SectionTitle title="12. 结果波动与数据限制" />
          {snapshot.volatility ? (
            <div className="rounded-md bg-surface-muted px-3 py-2 text-[11px]">
              <p className="font-medium">{snapshot.volatility.intervalLabel}：{pct(snapshot.volatility.observedMin)} ~ {pct(snapshot.volatility.observedMax)}（{snapshot.volatility.rounds} 轮）</p>
              <p className="mt-1 text-tertiary">{snapshot.volatility.note}</p>
              <p className="mt-1 text-warning">{snapshot.volatility.independentAssumptionNote}</p>
            </div>
          ) : (
            <p className="text-[11px] text-tertiary">历史轮次不足，未计算波动范围。</p>
          )}
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-tertiary">
            {snapshot.limitations.map((item, index) => <li key={index}>{item}</li>)}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <SectionTitle title="13. 可执行的优化建议" description="规则生成，均关联真实证据；不承诺提升，不把未发现解释为技术错误。" />
          {snapshot.suggestions.length === 0 ? (
            <p className="text-[11px] text-tertiary">当前没有规则建议。</p>
          ) : (
            <div className="space-y-2">
              {snapshot.suggestions.map((suggestion) => (
                <div key={suggestion.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium">{suggestion.title}</span>
                    <Badge variant={suggestion.priority === "HIGH" ? "destructive" : suggestion.priority === "MEDIUM" ? "warning" : "muted"}>
                      {suggestion.priority}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-secondary-soft">{suggestion.detail}</p>
                  {suggestion.questionRefs.length > 0 ? (
                    <p className="mt-1 text-[10px] text-quaternary">关联问题：{suggestion.questionRefs.slice(0, 6).join("；")}</p>
                  ) : null}
                  {suggestion.evidenceIds.length > 0 ? (
                    <p className="mt-1 text-[10px]">
                      关联证据：
                      {suggestion.evidenceIds.slice(0, 5).map((id) => (
                        <Link key={id} href={`/evidence/${id}`} className="mr-2 text-primary hover:underline">
                          {id.slice(0, 8)}…
                        </Link>
                      ))}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[10px] text-warning">{suggestion.caution}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <SectionTitle title="14. 报告生成时间与数据版本" />
          <div className="grid grid-cols-1 gap-1.5 text-[11px] text-tertiary sm:grid-cols-2">
            <p>生成时间：{new Date(snapshot.generatedAt).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}</p>
            <p>指标版本：{snapshot.dataVersion.metricsVersion}</p>
            <p>证据规则：{snapshot.dataVersion.evidenceRuleVersion}</p>
            <p>URL 规范化：{snapshot.dataVersion.urlNormalizationVersion}</p>
            <p>快照结构：{snapshot.dataVersion.snapshotSchemaVersion}</p>
            <p>比较版本：{snapshot.dataVersion.comparisonVersion}</p>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-quaternary">
            快照：{snapshot.dataVersion.snapshotIds.map((s) => `${s.kind}(${s.ruleVersion})`).join("；") || "—"}
          </p>
          <div className="mt-3 rounded-md bg-surface-muted p-3">
            <p className="text-[11px] font-medium text-secondary-soft">统计口径回顾</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[10px] leading-relaxed text-quaternary">
              {snapshot.methodology.map((item, index) => <li key={index}>{item}</li>)}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
