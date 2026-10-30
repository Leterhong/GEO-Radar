import { prisma } from "@/server/db/client";
import { parseBody, apiFail, withReadAuth, withWriteAuth } from "@/server/api/helpers";
import { searchTaskCreateSchema } from "@/lib/validation/schemas";
import { createSearchTask, SearchExecutionError } from "@/server/services/search-execution";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


export async function GET(request: Request) {
  return withReadAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? undefined;
    const brandId = url.searchParams.get("brandId") ?? undefined;
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
    const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize") ?? "15")));
    const where: Prisma.SearchTaskWhereInput = {
      workspaceId,
      ...(status ? { status: status as never } : {}),
      ...(brandId ? { brandId } : {}),
    };
    const [total, tasks] = await Promise.all([
      prisma.searchTask.count({ where }),
      prisma.searchTask.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          brand: { select: { id: true, name: true } },
          creator: { select: { name: true } },
        },
      }),
    ]);
    return { tasks, total, page, pageSize };
  });
}

/**
 * 创建搜索任务（QUEUED）。创建不发起任何真实请求；
 * 执行必须通过 /start 并由用户在前端主动确认后触发。
 */
export async function POST(request: Request) {
  try {
    return await withWriteAuth(async ({ workspaceId, user }) => {
      const body = await parseBody(request, searchTaskCreateSchema);
      try {
        const task = await createSearchTask(workspaceId, user.id, {
          name: body.name,
          description: body.description || undefined,
          brandId: body.brandId || undefined,
          questionSetId: body.questionSetId || undefined,
          questionIds: body.questionIds,
          questions: body.questions,
          provider: body.executionMode === "REAL" ? "YUANBAO" : "MOCK",
          executionMode: body.executionMode,
          maxResults: body.maxResults,
          mode: body.mode as 0 | 1 | 2 | undefined,
          industry: body.industry,
          freshness: body.freshness,
          site: body.site,
          deeplinks: body.deeplinks,
        });
        return NextResponse.json({ ok: true, data: task });
      } catch (error) {
        if (error instanceof SearchExecutionError) {
          return apiFail(400, error.code, error.message);
        }
        throw error;
      }
    });
  } catch (error) {
    return apiFail(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "创建任务失败");
  }
}
