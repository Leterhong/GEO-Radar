import { prisma } from "@/server/db/client";
import { parseBody, writeAuditLog, withReadAuth, withWriteAuth } from "@/server/api/helpers";
import { brandSchema } from "@/lib/validation/schemas";
import { extractWebsiteDomain } from "@/server/services/domain-normalization";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


export async function GET() {
  return withReadAuth(async ({ workspaceId }) => {
    const brands = await prisma.brand.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
    });
    return { brands };
  });
}

export async function POST(request: Request) {
  return withWriteAuth(async ({ workspaceId, user }) => {
    const body = await parseBody(request, brandSchema);
    const brand = await prisma.brand.create({
      data: {
        workspaceId,
        name: body.name,
        englishName: body.englishName || undefined,
        aliases: body.aliases ?? [],
        websiteUrl: body.websiteUrl || undefined,
        websiteDomain: extractWebsiteDomain(body.websiteUrl || undefined),
        industry: body.industry || undefined,
        description: body.description || undefined,
        keywords: body.keywords ?? [],
        officialSubdomains: (body.officialSubdomains ?? []).map((d) => d.toLowerCase().trim()),
        products: body.products ?? [],
        productAliases: body.productAliases ?? [],
      },
    });
    await writeAuditLog({
      workspaceId,
      userId: user.id,
      action: "BRAND_CREATED",
      targetType: "Brand",
      targetId: brand.id,
    });
    return NextResponse.json({ ok: true, data: brand });
  });
}
