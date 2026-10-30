import { prisma } from "@/server/db/client";
import { parseBody, apiFail, writeAuditLog, withReadAuth, withWriteAuth } from "@/server/api/helpers";
import { compareTasks } from "@/server/services/experiments";
import { NextResponse } from "next/server";
import { z } from "zod";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


const createSchema = z.object({
  name: z.string().trim().min(1, "请填写实验名称").max(100),
  baselineTaskId: z.string().min(1, "请选择基线任务"),
  retestTaskId: z.string().min(1, "请选择复测任务"),
});

export async function GET() {
  return withReadAuth(async ({ workspaceId }) => {
    const experiments = await prisma.auditLog.findMany({
      where: { workspaceId, action: "EXPERIMENT_CREATED" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    // 候选任务：真实模式、已完成
    const tasks = await prisma.searchTask.findMany({
      where: { workspaceId, executionMode: "REAL", status: { in: ["COMPLETED", "PARTIAL_FAILED"] } },
      orderBy: { finishedAt: "desc" },
      take: 50,
      include: { brand: { select: { name: true } } },
    });
    return {
      experiments: experiments.map((e) => ({
        id: e.id,
        name: (e.metadata as { name?: string })?.name ?? "(实验)",
        createdAt: e.createdAt,
        baselineTaskId: (e.metadata as { baselineTaskId?: string })?.baselineTaskId,
        retestTaskId: (e.metadata as { retestTaskId?: string })?.retestTaskId,
        comparison: (e.metadata as { comparison?: unknown })?.comparison,
      })),
      candidateTasks: tasks.map((t) => ({
        id: t.id,
        name: t.name,
        brandName: t.brand?.name,
        finishedAt: t.finishedAt,
        status: t.status,
        brandId: t.brandId,
      })),
    };
  });
}

export async function POST(request: Request) {
  return withWriteAuth(async ({ workspaceId, user }) => {
    const body = await parseBody(request, createSchema);
    if (body.baselineTaskId === body.retestTaskId) {
      return apiFail(400, "SAME_TASK", "基线任务与复测任务不能相同。");
    }
    try {
      const comparison = await compareTasks(workspaceId, body.baselineTaskId, body.retestTaskId);
      await writeAuditLog({
        workspaceId,
        userId: user.id,
        action: "EXPERIMENT_CREATED",
        metadata: {
          name: body.name,
          baselineTaskId: body.baselineTaskId,
          retestTaskId: body.retestTaskId,
          comparison,
        },
      });
      return NextResponse.json({ ok: true, data: comparison });
    } catch (error) {
      return apiFail(400, "COMPARISON_FAILED", error instanceof Error ? error.message : "对比失败");
    }
  });
}
