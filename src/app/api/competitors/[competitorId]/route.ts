import { prisma } from "@/server/db/client";
import { withAuth, parseBody, apiFail } from "@/server/api/helpers";
import { competitorSchema } from "@/lib/validation/schemas";
import { extractWebsiteDomain } from "@/server/services/domain-normalization";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


type Params = { params: { competitorId: string } };

export async function PATCH(request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId }) => {
    const existing = await prisma.competitor.findFirst({ where: { id: params.competitorId, workspaceId } });
    if (!existing) return apiFail(404, "NOT_FOUND", "竞品不存在或不属于当前工作空间。");
    const body = await parseBody(request, competitorSchema.partial().omit({ brandId: true }));
    const competitor = await prisma.competitor.update({
      where: { id: existing.id },
      data: {
        name: body.name,
        aliases: body.aliases,
        websiteUrl: body.websiteUrl !== undefined ? body.websiteUrl || undefined : undefined,
        websiteDomain:
          body.websiteUrl !== undefined ? extractWebsiteDomain(body.websiteUrl || undefined) : undefined,
        industry: body.industry,
        products: body.products,
        productAliases: body.productAliases,
        enabled: body.enabled,
        description: body.description,
        note: body.note,
      },
    });
    return NextResponse.json({ ok: true, data: competitor });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return withAuth(async ({ workspaceId }) => {
    const existing = await prisma.competitor.findFirst({ where: { id: params.competitorId, workspaceId } });
    if (!existing) return apiFail(404, "NOT_FOUND", "竞品不存在或不属于当前工作空间。");
    await prisma.competitor.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true, data: {} });
  });
}
