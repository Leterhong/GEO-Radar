import { prisma } from "@/server/db/client";
import { withAuth, apiFail, rateLimit } from "@/server/api/helpers";
import { reanalyzeTaskEvidence, SnapshotError } from "@/server/services/snapshot-service";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  taskId: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

/**
 * 重算历史证据分析层（不修改原始搜索结果）：
 * - 指定 taskId：仅重算该任务；
 * - 不指定：扫描当前工作空间中仍含旧规则证据（sourceRole=UNKNOWN）的任务，最多 50 个。
 * 每个任务会生成 RECOMPUTE 快照，保留原 COLLECTION 快照。
 */
export async function POST(request: Request) {
  return withAuth(async ({ workspaceId, user }) => {
    rateLimit(`evidence-reanalyze:${workspaceId}`, 3, 10 * 60 * 1000);
    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body ?? {});
    if (!parsed.success) return apiFail(400, "VALIDATION_ERROR", "请求参数校验失败");

    let taskIds: string[] = [];
    if (parsed.data.taskId) {
      const task = await prisma.searchTask.findFirst({
        where: { id: parsed.data.taskId, workspaceId },
        select: { id: true },
      });
      if (!task) return apiFail(404, "TASK_NOT_FOUND", "任务不存在或不属于当前工作空间。");
      taskIds = [task.id];
    } else {
      const tasks = await prisma.searchTask.findMany({
        where: {
          workspaceId,
          status: { notIn: ["QUEUED", "RUNNING"] },
          evidence: { some: { sourceRole: "UNKNOWN" } },
        },
        select: { id: true },
        orderBy: { createdAt: "desc" },
        take: parsed.data.limit ?? 20,
      });
      taskIds = tasks.map((t) => t.id);
    }

    const results: Array<{ taskId: string; updated: number; snapshotId: string; error?: string }> = [];
    for (const taskId of taskIds) {
      try {
        const result = await reanalyzeTaskEvidence(workspaceId, taskId, user.id);
        results.push({ taskId, updated: result.updated, snapshotId: result.snapshot.id });
      } catch (error) {
        results.push({
          taskId,
          updated: 0,
          snapshotId: "",
          error: error instanceof SnapshotError ? error.message : "重算失败",
        });
      }
    }
    return NextResponse.json({
      ok: true,
      data: {
        tasks: results.length,
        updated: results.reduce((sum, r) => sum + r.updated, 0),
        results,
      },
    });
  });
}
