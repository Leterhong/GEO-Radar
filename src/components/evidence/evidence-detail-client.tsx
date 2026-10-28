"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InlineAlert, SectionTitle } from "@/components/shared/kpi-card";
import { formatDate } from "@/lib/utils";
import { ArrowLeft, Check, ExternalLink, HelpCircle, Save, X } from "lucide-react";

const PAGE_TYPES = [
  "OFFICIAL_HOMEPAGE",
  "PRODUCT_PAGE",
  "DOCS_PAGE",
  "BLOG_NEWS",
  "THIRD_PARTY_MEDIA",
  "ECOMMERCE_PAGE",
  "COMMUNITY_FORUM",
  "OTHER",
  "UNKNOWN",
] as const;

const PAGE_TYPE_LABELS: Record<string, string> = {
  OFFICIAL_HOMEPAGE: "官网首页",
  PRODUCT_PAGE: "产品页",
  DOCS_PAGE: "文档/帮助中心",
  BLOG_NEWS: "博客/资讯页",
  THIRD_PARTY_MEDIA: "第三方媒体页",
  ECOMMERCE_PAGE: "电商/商品页",
  COMMUNITY_FORUM: "社区/论坛页",
  OTHER: "其他页面",
  UNKNOWN: "未知类型",
};

const MENTION_LABELS: Record<string, string> = {
  PENDING_REVIEW: "待复核",
  CONFIRMED_BRAND: "确认本品牌",
  CONFIRMED_COMPETITOR: "确认竞品",
  IRRELEVANT: "无关结果",
  AMBIGUOUS: "存在歧义",
};

const ACTION_LABELS: Record<string, string> = {
  CONFIRM_MATCH: "确认匹配",
  REJECT_MATCH: "确认不匹配",
  MARK_UNCERTAIN: "标记为不确定",
  SET_PAGE_TYPE: "修改页面类型",
  SET_BRAND: "修改品牌归属",
  SET_MENTION_STATUS: "修改提及状态",
  UPDATE_METADATA: "更新元数据",
};

interface ReviewRow {
  id: string;
  action: string;
  note: string | null;
  createdAt: string;
  reviewer: { name: string } | null;
  previous: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
}

interface EvidenceDetail {
  id: string;
  title: string;
  url: string;
  normalizedUrl: string | null;
  domain: string | null;
  snippet: string | null;
  publishedAt: string | null;
  collectedAt: string;
  provider: string;
  requestId: string | null;
  isMock: boolean;
  pageType: string;
  pageTypeSource: string;
  pageTypeRule: string | null;
  sourceRole: string;
  mentionStatus: string;
  detectionMethod: string;
  brandMatchBasis: string[];
  matchedTerms: string[];
  competitorMatches: string[];
  officialDomainMatch: boolean;
  thirdPartyMention: boolean;
  relevance: string;
  tags: string[];
  reviewNote: string | null;
  reviewedAt: string | null;
  ruleVersion: string;
  analyzedAt: string;
  brand: { id: string; name: string } | null;
  reviewer: { name: string } | null;
  task: { id: string; name: string; executionMode: string; provider: string; status: string; questionSetVersion: number | null; finishedAt: string | null };
  result: { position: number; extra: Record<string, unknown> | null } | null;
  rawResponse: { id: string; requestId: string | null; httpStatus: number | null; byteSize: number; truncated: boolean; createdAt: string } | null;
  reviews: ReviewRow[];
}

interface BrandOption {
  id: string;
  name: string;
}

interface QuestionInfo {
  questionText: string;
  category: string | null;
  itemId: string;
  executedAt: string | null;
  providerRequestId: string | null;
}

export function EvidenceDetailClient({
  evidence: initial,
  brands,
  question,
}: {
  evidence: EvidenceDetail;
  brands: BrandOption[];
  question: QuestionInfo | null;
}) {
  const router = useRouter();
  const [evidence, setEvidence] = useState(initial);
  const [note, setNote] = useState(initial.reviewNote ?? "");
  const [pageType, setPageType] = useState(initial.pageType);
  const [brandId, setBrandId] = useState(initial.brand?.id ?? "none");
  const [relevance, setRelevance] = useState(initial.relevance);
  const [tags, setTags] = useState(initial.tags.join("、"));
  const [busy, setBusy] = useState(false);

  // 服务端刷新后同步新数据（复核记录/自动分类结果）
  useEffect(() => {
    setEvidence(initial);
    setNote(initial.reviewNote ?? "");
    setPageType(initial.pageType);
    setBrandId(initial.brand?.id ?? "none");
    setRelevance(initial.relevance);
    setTags(initial.tags.join("、"));
  }, [initial]);

  async function patch(payload: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/evidence/${evidence.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message ?? "保存失败");
        return;
      }
      toast.success(successMessage);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const basisText = evidence.brandMatchBasis.length > 0 ? evidence.brandMatchBasis.join("、") : "—";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href="/evidence">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> 返回证据库
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/search-lab/${evidence.task.id}`}>所属任务</Link>
        </Button>
        {evidence.task.status === "COMPLETED" || evidence.task.status === "PARTIAL_FAILED" ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/matrix?brandId=${evidence.brand?.id ?? ""}`}>查看问题矩阵</Link>
          </Button>
        ) : null}
      </div>

      <Card className="mb-4">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-[20px] font-semibold leading-snug tracking-tight">{evidence.title}</h1>
              <p className="mt-1 truncate font-mono text-[12px] text-tertiary">{evidence.normalizedUrl ?? evidence.url}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                <Badge variant={evidence.isMock ? "warning" : "success"}>{evidence.isMock ? "模拟数据" : "真实数据"}</Badge>
                <Badge variant={evidence.mentionStatus === "CONFIRMED_BRAND" ? "success" : evidence.mentionStatus === "PENDING_REVIEW" ? "warning" : "muted"}>
                  {MENTION_LABELS[evidence.mentionStatus] ?? evidence.mentionStatus}
                </Badge>
                <Badge variant="info">{PAGE_TYPE_LABELS[evidence.pageType] ?? evidence.pageType}</Badge>
                <Badge variant="secondary">{evidence.sourceRole === "OFFICIAL" ? "官网" : evidence.sourceRole === "THIRD_PARTY" ? "第三方" : "来源未知"}</Badge>
                <span className="text-quaternary">采集于 {formatDate(evidence.collectedAt)}</span>
              </div>
            </div>
            <a
              href={evidence.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-3 py-1.5 text-[12px] text-primary hover:bg-surface-muted"
            >
              打开原始页面 <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardContent className="p-5">
              <SectionTitle title="原始搜索结果（不可修改）" description="接口实际返回的标题、URL、摘要与元数据；人工复核只修改分析层字段。" />
              <dl className="grid grid-cols-1 gap-3 text-[12px] sm:grid-cols-2">
                <div>
                  <dt className="text-quaternary">原始 URL</dt>
                  <dd className="mt-0.5 break-all font-mono text-[11px]">{evidence.url}</dd>
                </div>
                <div>
                  <dt className="text-quaternary">规范化 URL（比较用）</dt>
                  <dd className="mt-0.5 break-all font-mono text-[11px]">{evidence.normalizedUrl ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-quaternary">域名</dt>
                  <dd className="mt-0.5">{evidence.domain ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-quaternary">发布时间（接口原值）</dt>
                  <dd className="mt-0.5">{evidence.publishedAt ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-quaternary">RequestId</dt>
                  <dd className="mt-0.5 break-all font-mono text-[11px]">{evidence.requestId ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-quaternary">结果位置</dt>
                  <dd className="mt-0.5">{evidence.result?.position ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-quaternary">原始响应</dt>
                  <dd className="mt-0.5">
                    {evidence.rawResponse
                      ? `${evidence.rawResponse.byteSize} 字节 · HTTP ${evidence.rawResponse.httpStatus ?? "—"}${evidence.rawResponse.truncated ? " · 已截断" : ""}`
                      : "未保存原始响应（模拟模式或早期数据）"}
                  </dd>
                </div>
                <div>
                  <dt className="text-quaternary">规则版本</dt>
                  <dd className="mt-0.5 font-mono text-[11px]">{evidence.ruleVersion}</dd>
                </div>
              </dl>
              <div className="mt-3 rounded-md border border-border bg-surface-muted/60 p-3">
                <p className="text-[11px] text-quaternary">接口返回摘要</p>
                <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-secondary-soft">
                  {evidence.snippet ?? "（接口未返回摘要）"}
                </p>
              </div>
              {evidence.result?.extra ? (
                <details className="mt-3 text-[11px] text-tertiary">
                  <summary className="cursor-pointer">查看其他已保存元数据</summary>
                  <pre className="mt-2 max-h-52 overflow-auto rounded-md bg-surface-muted p-3 text-[10px] leading-relaxed">
                    {JSON.stringify(evidence.result.extra, null, 2)}
                  </pre>
                </details>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <SectionTitle title="页面级分析结果" description={`规则版本 ${evidence.ruleVersion}；页面类型来源：${evidence.pageTypeSource === "MANUAL" ? "人工修正" : "规则识别"}。`} />
              <div className="grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2">
                <p>
                  <span className="text-quaternary">页面类型：</span>
                  {PAGE_TYPE_LABELS[evidence.pageType] ?? evidence.pageType}
                  {evidence.pageTypeRule ? <span className="ml-1 font-mono text-[10px] text-quaternary">({evidence.pageTypeRule})</span> : null}
                </p>
                <p>
                  <span className="text-quaternary">来源角色：</span>
                  {evidence.sourceRole === "OFFICIAL" ? "官网" : evidence.sourceRole === "THIRD_PARTY" ? "第三方" : "未知"}
                </p>
                <p>
                  <span className="text-quaternary">官网域名匹配：</span>
                  {evidence.officialDomainMatch ? "是" : "否"}
                </p>
                <p>
                  <span className="text-quaternary">第三方提及：</span>
                  {evidence.thirdPartyMention ? "是" : "否"}
                </p>
                <p className="sm:col-span-2">
                  <span className="text-quaternary">匹配依据：</span>
                  {basisText}
                </p>
                <p>
                  <span className="text-quaternary">命中术语：</span>
                  {evidence.matchedTerms.join("、") || "—"}
                </p>
                <p>
                  <span className="text-quaternary">竞品匹配：</span>
                  {evidence.competitorMatches.join("、") || "—"}
                </p>
              </div>
              <InlineAlert tone="info" className="mt-3">
                「是否被最终生成式回答引用」无法从普通搜索结果推断；本页不提供该字段，也不做推测。
              </InlineAlert>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <SectionTitle title="人工复核记录" description={`共 ${evidence.reviews.length} 条。每次变更保存操作人、时间与前后值。`} />
              {evidence.reviews.length === 0 ? (
                <p className="text-[12px] text-tertiary">还没有人工复核记录。</p>
              ) : (
                <ol className="space-y-2">
                  {evidence.reviews.map((review) => (
                    <li key={review.id} className="rounded-md border border-border px-3 py-2 text-[11px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{ACTION_LABELS[review.action] ?? review.action}</Badge>
                        <span className="text-tertiary">{review.reviewer?.name ?? "系统"}</span>
                        <span className="text-quaternary">{formatDate(review.createdAt)}</span>
                      </div>
                      {review.note ? <p className="mt-1 text-secondary-soft">{review.note}</p> : null}
                      <p className="mt-1 font-mono text-[10px] text-quaternary">
                        mentionStatus: {String(review.previous?.mentionStatus ?? "—")} → {String(review.next?.mentionStatus ?? "—")}
                        {" · "}pageType: {String(review.previous?.pageType ?? "—")} → {String(review.next?.pageType ?? "—")}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="p-5">
              <SectionTitle title="所属问题" description="历史任务保存执行时的问题快照。" />
              {question ? (
                <div className="space-y-1.5 text-[12px]">
                  <p className="font-medium leading-relaxed">{question.questionText}</p>
                  <p className="text-tertiary">类别：{question.category ?? "未分类"}</p>
                  <p className="text-tertiary">执行时间：{question.executedAt ? formatDate(question.executedAt) : "—"}</p>
                  <p className="break-all font-mono text-[10px] text-quaternary">请求：{question.providerRequestId ?? evidence.requestId ?? "—"}</p>
                </div>
              ) : (
                <p className="text-[12px] text-tertiary">问题记录不可用（可能已被删除），历史证据仍保留。</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <SectionTitle title="人工复核" description="复核只影响分析层；原始结果保持可追溯。" />
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" onClick={() => void patch({ reviewAction: "CONFIRM_MATCH", reviewNote: note }, "已确认匹配")} disabled={busy}>
                    <Check className="mr-1 h-3.5 w-3.5" /> 确认匹配
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void patch({ reviewAction: "REJECT_MATCH", reviewNote: note }, "已确认不匹配")} disabled={busy}>
                    <X className="mr-1 h-3.5 w-3.5" /> 确认不匹配
                  </Button>
                  <Button size="sm" variant="outline" className="col-span-2" onClick={() => void patch({ reviewAction: "MARK_UNCERTAIN", reviewNote: note }, "已标记为不确定")} disabled={busy}>
                    <HelpCircle className="mr-1 h-3.5 w-3.5" /> 标记为不确定
                  </Button>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12px] text-secondary-soft">页面类型</label>
                  <div className="flex gap-2">
                    <Select value={pageType} onValueChange={setPageType}>
                      <SelectTrigger className="h-8 flex-1 text-[12px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAGE_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {PAGE_TYPE_LABELS[type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" onClick={() => void patch({ pageType, reviewNote: note }, "页面类型已保存")} disabled={busy}>
                      保存
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12px] text-secondary-soft">品牌归属</label>
                  <div className="flex gap-2">
                    <Select value={brandId} onValueChange={setBrandId}>
                      <SelectTrigger className="h-8 flex-1 text-[12px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">不归属任何品牌</SelectItem>
                        {brands.map((brand) => (
                          <SelectItem key={brand.id} value={brand.id}>
                            {brand.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void patch({ brandId: brandId === "none" ? null : brandId, reviewNote: note }, "品牌归属已保存")}
                      disabled={busy}
                    >
                      保存
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12px] text-secondary-soft">相关性</label>
                  <Select
                    value={relevance}
                    onValueChange={(value) => {
                      setRelevance(value);
                      void patch({ relevance: value }, "相关性已保存");
                    }}
                  >
                    <SelectTrigger className="h-8 text-[12px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HIGH">高</SelectItem>
                      <SelectItem value="MEDIUM">中</SelectItem>
                      <SelectItem value="LOW">低</SelectItem>
                      <SelectItem value="UNKNOWN">未知</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12px] text-secondary-soft">标签（用顿号或逗号分隔）</label>
                  <div className="flex gap-2">
                    <Input value={tags} onChange={(e) => setTags(e.target.value)} className="h-8 text-[12px]" placeholder="例如：竞品对比、官网" />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void patch(
                          { tags: tags.split(/[,，、\n]/).map((t) => t.trim()).filter(Boolean).slice(0, 10) },
                          "标签已保存"
                        )
                      }
                      disabled={busy}
                    >
                      保存
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12px] text-secondary-soft">复核备注</label>
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} placeholder="记录判断依据，便于后续追溯" />
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => void patch({ reviewNote: note }, "备注已保存")}
                  disabled={busy}
                >
                  <Save className="mr-1 h-3.5 w-3.5" /> 保存备注
                </Button>
                <p className="text-[10px] leading-relaxed text-quaternary">
                  当前判定：{MENTION_LABELS[evidence.mentionStatus] ?? evidence.mentionStatus} ·{" "}
                  {evidence.detectionMethod === "MANUAL" ? "人工" : "规则"}；最近复核：
                  {evidence.reviewedAt ? `${formatDate(evidence.reviewedAt)} ${evidence.reviewer?.name ?? ""}` : "—"}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
