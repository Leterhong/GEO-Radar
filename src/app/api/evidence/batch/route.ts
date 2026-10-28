import { prisma } from "@/server/db/client";
import { withAuth, parseBody, apiFail, writeAuditLog } from "@/server/api/helpers";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(["archive", "tag", "relevance"]),
  tags: z.array(z.string().trim().min(1).max(24)).max(10).optional(),
  relevance: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]).optional(),
});

/**
 * 批量操作证据：只处理属于当前工作空间的记录，返回真实成功/失败/跳过数量。
 * archive 为「移出证据库」（保留原始任务与搜索结果，可追溯）。
 */
export async function POST(request: Request) {
  return withAuth(async ({ workspaceId, user }) => {
    const body = await parseBody(request, schema);
    const uniqueIds = Array.from(new Set(body.ids));

    const owned = await prisma.evidence.findMany({
      where: { id: { in: uniqueIds }, workspaceId },
      select: { id: true, mentionStatus: true },
    });
    const ownedIds = owned.map((e) => e.id);
    const skipped = uniqueIds.length - ownedIds.length;

    let updated = 0;
    if (ownedIds.length > 0) {
      if (body.action === "archive") {
        const already = owned.filter((e) => e.mentionStatus === "IRRELEVANT").length;
        const result = await prisma.evidence.updateMany({
          where: { id: { in: ownedIds } },
          data: { mentionStatus: "IRRELEVANT", reviewNote: "（已批量移出证据库）", detectionMethod: "MANUAL" },
        });
        updated = result.count;
        await writeAuditLog({
          workspaceId,
          userId: user.id,
          action: "EVIDENCE_BATCH_ARCHIVED",
          metadata: { requested: uniqueIds.length, updated: result.count, alreadyArchived: already, skipped },
        });
        return NextResponse.json({ ok: true, data: { updated, skipped, alreadyArchived: already } });
      }
      if (body.action === "tag" && body.tags) {
        for (const id of ownedIds) {
          const current = await prisma.evidence.findUnique({ where: { id }, select: { tags: true } });
          const merged = Array.from(new Set([...(current?.tags ?? []), ...(body.tags ?? [])])).slice(0, 10);
          await prisma.evidence.update({ where: { id }, data: { tags: merged } });
          updated += 1;
        }
      } else if (body.action === "relevance" && body.relevance) {
        const result = await prisma.evidence.updateMany({
          where: { id: { in: ownedIds } },
          data: { relevance: body.relevance },
        });
        updated = result.count;
      }
      await writeAuditLog({
        workspaceId,
        userId: user.id,
        action: "EVIDENCE_BATCH_UPDATED",
        metadata: { action: body.action, requested: uniqueIds.length, updated, skipped },
      });
    }
    return NextResponse.json({ ok: true, data: { updated, skipped } });
  });
}
