import { prisma } from "@/server/db/client";
import { withAuth, apiFail } from "@/server/api/helpers";
import { createTaskSnapshot, reanalyzeTaskEvidence, SnapshotError } from "@/server/services/snapshot-service";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Params = { params: { taskId: string } };

const postSchema = z.object({
  kind: z.enum(["COLLECTION", "RECOMPUTE"]).optional(),
});

export async function GET(_request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId }) => {
    const task = await prisma.searchTask.findFirst({
      where: { id: params.taskId, workspaceId },
      select: { id: true, name: true, status: true, questionSetVersion: true, questionSetVersionId: true },
    });
    if (!task) return apiFail(404, "NOT_FOUND", "任务不存在或不属于当前工作空间。");
    const snapshots = await prisma.analysisSnapshot.findMany({
      where: { workspaceId, taskId: task.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        kind: true,
        ruleVersion: true,
        questionSetVersion: true,
        summary: true,
        evidenceCount: true,
        truncated: true,
        createdAt: true,
      },
    });
    return { task, snapshots };
  });
}

/**
 * 创建快照：
 * - RECOMPUTE：使用当前品牌配置/规则重新分析证据并生成新快照（不覆盖历史 COLLECTION 快照，不触碰原始结果）
 * - COLLECTION：为已完成任务补建采集快照（若同规则快照已存在则直接返回）
 */
export async function POST(request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId, user }) => {
    const body = (await request.json().catch(() => ({}))) ?? {};
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) return apiFail(400, "VALIDATION_ERROR", "请求参数校验失败");
    try {
      if (parsed.data.kind === "RECOMPUTE") {
        const result = await reanalyzeTaskEvidence(workspaceId, params.taskId, user.id);
        return NextResponse.json({
          ok: true,
          data: {
            snapshotId: result.snapshot.id,
            ruleVersion: result.snapshot.ruleVersion,
            mode: "RECOMPUTE",
            updated: result.updated,
            skippedManual: result.skippedManual,
          },
        });
      }
      const snapshot = await createTaskSnapshot(workspaceId, params.taskId, {
        kind: "COLLECTION",
        createdById: user.id,
      });
      return NextResponse.json({
        ok: true,
        data: { snapshotId: snapshot.id, ruleVersion: snapshot.ruleVersion, mode: "COLLECTION" },
      });
    } catch (error) {
      if (error instanceof SnapshotError) return apiFail(400, error.code, error.message);
      throw error;
    }
  });
}
