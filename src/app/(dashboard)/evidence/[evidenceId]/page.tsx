import { notFound } from "next/navigation";
import { requireWorkspace } from "@/server/auth/guard";
import { prisma } from "@/server/db/client";
import { EvidenceDetailClient } from "@/components/evidence/evidence-detail-client";

export const dynamic = "force-dynamic";

export default async function EvidenceDetailPage({ params }: { params: { evidenceId: string } }) {
  const { workspaceId } = await requireWorkspace();
  const evidence = await prisma.evidence.findFirst({
    where: { id: params.evidenceId, workspaceId },
    include: {
      task: { select: { id: true, name: true, executionMode: true, provider: true, status: true, questionSetVersion: true, finishedAt: true } },
      brand: { select: { id: true, name: true } },
      reviewer: { select: { name: true } },
      result: { select: { position: true, extra: true, itemId: true } },
      rawResponse: { select: { id: true, requestId: true, httpStatus: true, byteSize: true, truncated: true, createdAt: true } },
      reviews: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { reviewer: { select: { name: true } } },
      },
    },
  });
  if (!evidence) notFound();

  const [brands, item] = await Promise.all([
    prisma.brand.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } }),
    evidence.result?.itemId
      ? prisma.searchTaskItem.findFirst({
          where: { id: evidence.result.itemId, workspaceId },
          select: {
            questionText: true,
            categorySnapshot: true,
            id: true,
            executedAt: true,
            providerRequestId: true,
            question: { select: { category: true } },
          },
        })
      : null,
  ]);

  return (
    <EvidenceDetailClient
      evidence={{
        id: evidence.id,
        title: evidence.title,
        url: evidence.url,
        normalizedUrl: evidence.normalizedUrl,
        domain: evidence.domain,
        snippet: evidence.snippet,
        publishedAt: evidence.publishedAt,
        collectedAt: evidence.collectedAt.toISOString(),
        provider: evidence.provider,
        requestId: evidence.requestId,
        isMock: evidence.isMock,
        pageType: evidence.pageType,
        pageTypeSource: evidence.pageTypeSource,
        pageTypeRule: evidence.pageTypeRule,
        sourceRole: evidence.sourceRole,
        mentionStatus: evidence.mentionStatus,
        detectionMethod: evidence.detectionMethod,
        brandMatchBasis: evidence.brandMatchBasis,
        matchedTerms: evidence.matchedTerms,
        competitorMatches: evidence.competitorMatches,
        officialDomainMatch: evidence.officialDomainMatch,
        thirdPartyMention: evidence.thirdPartyMention,
        relevance: evidence.relevance,
        tags: evidence.tags,
        reviewNote: evidence.reviewNote,
        reviewedAt: evidence.reviewedAt?.toISOString() ?? null,
        ruleVersion: evidence.ruleVersion,
        analyzedAt: evidence.analyzedAt.toISOString(),
        brand: evidence.brand,
        reviewer: evidence.reviewer,
        task: {
          id: evidence.task.id,
          name: evidence.task.name,
          executionMode: evidence.task.executionMode,
          provider: evidence.task.provider,
          status: evidence.task.status,
          questionSetVersion: evidence.task.questionSetVersion,
          finishedAt: evidence.task.finishedAt?.toISOString() ?? null,
        },
        result: evidence.result ? { position: evidence.result.position, extra: (evidence.result.extra ?? null) as Record<string, unknown> | null } : null,
        rawResponse: evidence.rawResponse
          ? {
              id: evidence.rawResponse.id,
              requestId: evidence.rawResponse.requestId,
              httpStatus: evidence.rawResponse.httpStatus,
              byteSize: evidence.rawResponse.byteSize,
              truncated: evidence.rawResponse.truncated,
              createdAt: evidence.rawResponse.createdAt.toISOString(),
            }
          : null,
        reviews: evidence.reviews.map((review) => ({
          id: review.id,
          action: review.action,
          note: review.note,
          createdAt: review.createdAt.toISOString(),
          reviewer: review.reviewer,
          previous: (review.previous ?? null) as Record<string, unknown> | null,
          next: (review.next ?? null) as Record<string, unknown> | null,
        })),
      }}
      brands={brands}
      question={
        item
          ? {
              questionText: item.questionText,
              category: item.categorySnapshot ?? item.question?.category ?? null,
              itemId: item.id,
              executedAt: item.executedAt?.toISOString() ?? null,
              providerRequestId: item.providerRequestId,
            }
          : null
      }
    />
  );
}
