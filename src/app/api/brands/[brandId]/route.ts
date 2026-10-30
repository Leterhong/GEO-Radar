import { prisma } from "@/server/db/client";
import { parseBody, writeAuditLog, apiFail, withReadAuth, withWriteAuth } from "@/server/api/helpers";
import { brandSchema } from "@/lib/validation/schemas";
import { extractWebsiteDomain } from "@/server/services/domain-normalization";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


type Params = { params: { brandId: string } };

export async function GET(_request: Request, { params }: Params) {
  return withReadAuth(async ({ workspaceId }) => {
    const brand = await prisma.brand.findFirst({ where: { id: params.brandId, workspaceId } });
    if (!brand) return apiFail(404, "NOT_FOUND", "品牌不存在或不属于当前工作空间。");
    return NextResponse.json({ ok: true, data: brand });
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return withWriteAuth(async ({ workspaceId, user }) => {
    const existing = await prisma.brand.findFirst({ where: { id: params.brandId, workspaceId } });
    if (!existing) return apiFail(404, "NOT_FOUND", "品牌不存在或不属于当前工作空间。");
    const body = await parseBody(request, brandSchema.partial());
    const brand = await prisma.brand.update({
      where: { id: existing.id },
      data: {
        name: body.name,
        englishName: body.englishName,
        aliases: body.aliases,
        websiteUrl: body.websiteUrl !== undefined ? body.websiteUrl || undefined : undefined,
        websiteDomain:
          body.websiteUrl !== undefined ? extractWebsiteDomain(body.websiteUrl || undefined) : undefined,
        industry: body.industry,
        description: body.description,
        keywords: body.keywords,
        officialSubdomains:
          body.officialSubdomains !== undefined
            ? body.officialSubdomains.map((d) => d.toLowerCase().trim())
            : undefined,
        products: body.products,
        productAliases: body.productAliases,
      },
    });
    await writeAuditLog({
      workspaceId,
      userId: user.id,
      action: "BRAND_UPDATED",
      targetType: "Brand",
      targetId: brand.id,
    });
    return NextResponse.json({ ok: true, data: brand });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return withWriteAuth(async ({ workspaceId, user }) => {
    const existing = await prisma.brand.findFirst({ where: { id: params.brandId, workspaceId } });
    if (!existing) return apiFail(404, "NOT_FOUND", "品牌不存在或不属于当前工作空间。");
    await prisma.$transaction([
      // 先暂停引用它的启用排期，再删除品牌（删除时 schedule.brandId 会被 SetNull）
      prisma.schedule.updateMany({
        where: { workspaceId, brandId: existing.id, status: "ACTIVE" },
        data: { status: "PAUSED", nextRunAt: null },
      }),
      prisma.brand.delete({ where: { id: existing.id } }),
    ]);
    await writeAuditLog({
      workspaceId,
      userId: user.id,
      action: "BRAND_DELETED",
      targetType: "Brand",
      targetId: existing.id,
    });
    return NextResponse.json({ ok: true, data: {} });
  });
}
