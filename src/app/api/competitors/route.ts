import { prisma } from "@/server/db/client";
import { withAuth, parseBody, apiFail } from "@/server/api/helpers";
import { competitorSchema } from "@/lib/validation/schemas";
import { extractWebsiteDomain } from "@/server/services/domain-normalization";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


export async function GET() {
  return withAuth(async ({ workspaceId }) => {
    const competitors = await prisma.competitor.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
    });
    return { competitors };
  });
}

export async function POST(request: Request) {
  return withAuth(async ({ workspaceId }) => {
    const body = await parseBody(request, competitorSchema);
    const brand = await prisma.brand.findFirst({ where: { id: body.brandId, workspaceId } });
    if (!brand) return apiFail(404, "BRAND_NOT_FOUND", "关联品牌不存在或不属于当前工作空间。");
    const competitor = await prisma.competitor.create({
      data: {
        workspaceId,
        brandId: brand.id,
        name: body.name,
        aliases: body.aliases ?? [],
        websiteUrl: body.websiteUrl || undefined,
        websiteDomain: extractWebsiteDomain(body.websiteUrl || undefined),
        description: body.description || undefined,
        note: body.note || undefined,
      },
    });
    return NextResponse.json({ ok: true, data: competitor });
  });
}
