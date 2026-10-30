import { prisma } from "@/server/db/client";
import { parseBody, apiFail, withReadAuth, withWriteAuth } from "@/server/api/helpers";
import { optimizationTaskSchema } from "@/lib/validation/schemas";
import { generateRecommendations } from "@/server/services/recommendations";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


export async function GET(request: Request) {
  return withReadAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    const brandId = url.searchParams.get("brandId") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;
    const tasks = await prisma.optimizationTask.findMany({
      where: { workspaceId, ...(brandId ? { brandId } : {}), ...(status ? { status: status as never } : {}) },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: { brand: { select: { id: true, name: true } } },
    });
    return { tasks };
  });
}

/** 创建优化任务（手动）。 */
export async function POST(request: Request) {
  return withWriteAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    // ?generate=true 触发规则引擎生成
    if (url.searchParams.get("generate") === "true") {
      const brandId = url.searchParams.get("brandId");
      if (!brandId) return apiFail(400, "BRAND_REQUIRED", "请先选择品牌。");
      const result = await generateRecommendations(workspaceId, brandId);
      return NextResponse.json({ ok: true, data: result });
    }
    const body = await parseBody(request, optimizationTaskSchema);
    if (body.brandId) {
      const brand = await prisma.brand.findFirst({ where: { id: body.brandId, workspaceId } });
      if (!brand) return apiFail(404, "NOT_FOUND", "品牌不存在或不属于当前工作空间。");
    }
    const task = await prisma.optimizationTask.create({
      data: {
        workspaceId,
        brandId: body.brandId || undefined,
        title: body.title,
        description: body.description,
        pageUrl: body.pageUrl || undefined,
        type: body.type,
        priority: body.priority,
        status: "OPEN",
        assignee: body.assignee || undefined,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        generatedBy: "MANUAL",
      },
    });
    return NextResponse.json({ ok: true, data: task });
  });
}
