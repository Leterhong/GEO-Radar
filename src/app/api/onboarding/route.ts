import { prisma } from "@/server/db/client";
import { apiFail, writeAuditLog, withReadAuth, withWriteAuth } from "@/server/api/helpers";
import { workspaceCreateSchema } from "@/lib/validation/schemas";
import { extractWebsiteDomain } from "@/server/services/domain-normalization";
import { setActiveWorkspace, getActiveWorkspaceId, isSecureRequest } from "@/server/auth/session";
import { NextResponse } from "next/server";
import { z } from "zod";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


const brandInputSchema = z.object({
  name: z.string().trim().min(1, "请填写品牌名称").max(100),
  websiteUrl: z.string().trim().max(300).optional().or(z.literal("")),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
});

/**
 * 首次配置（幂等）：
 * - 无工作空间：创建工作空间 + 品牌；
 * - 已有工作空间但未填品牌：在当前空间补充品牌；
 * - 品牌已存在：直接返回成功（不返回 409，避免用户被卡住）。
 * 任何情况下都确保设置当前工作空间，完成后前端可直接进入首页。
 */
export async function POST(request: Request) {
  return withWriteAuth(async ({ user }) => {
    let body: { workspaceName?: string; brand?: { name?: string; websiteUrl?: string; description?: string } };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return apiFail(400, "INVALID_JSON", "请求体不是有效的 JSON。");
    }

    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      orderBy: { joinedAt: "asc" },
      include: { workspace: true },
    });

    let workspaceId: string;
    let brandId: string | undefined;
    let createdWorkspace = false;
    let createdBrand = false;

    if (membership) {
      workspaceId = membership.workspaceId;
    } else {
      const ws = workspaceCreateSchema.safeParse({ name: body.workspaceName ?? "" });
      if (!ws.success) return apiFail(400, "VALIDATION_ERROR", "请填写工作空间名称。");
      const workspace = await prisma.workspace.create({
        data: { name: ws.data.name, ownerId: user.id },
      });
      await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: user.id, role: "OWNER" },
      });
      workspaceId = workspace.id;
      createdWorkspace = true;
    }

    const brandInput = body.brand ?? {};
    const hasBrandInput = typeof brandInput.name === "string" && brandInput.name.trim() !== "";
    if (hasBrandInput) {
      const parsed = brandInputSchema.safeParse(brandInput);
      if (!parsed.success) return apiFail(400, "VALIDATION_ERROR", "品牌信息不正确，请检查后重试。");
      const existingBrand = await prisma.brand.findFirst({
        where: { workspaceId, name: parsed.data.name },
      });
      if (existingBrand) {
        brandId = existingBrand.id;
      } else {
        const brand = await prisma.brand.create({
          data: {
            workspaceId,
            name: parsed.data.name,
            websiteUrl: parsed.data.websiteUrl || undefined,
            websiteDomain: extractWebsiteDomain(parsed.data.websiteUrl || undefined),
            description: parsed.data.description || undefined,
            aliases: [],
            keywords: [],
          },
        });
        brandId = brand.id;
        createdBrand = true;
      }
    }

    await setActiveWorkspace(workspaceId, { secure: isSecureRequest(request) });
    await writeAuditLog({
      workspaceId,
      userId: user.id,
      action: createdWorkspace || createdBrand ? "ONBOARDING_COMPLETED" : "ONBOARDING_SKIPPED",
      targetType: "Brand",
      targetId: brandId,
      metadata: { createdWorkspace, createdBrand },
    });
    return NextResponse.json({
      ok: true,
      data: { workspaceId, brandId, createdWorkspace, createdBrand },
    });
  });
}

/** 引导状态：前端与冒烟测试用于判断是否还需展示引导页。 */
export async function GET() {
  return withReadAuth(async ({ user }) => {
    const workspaceId = await getActiveWorkspaceId(user.id);
    const brandCount = workspaceId
      ? await prisma.brand.count({ where: { workspaceId } })
      : 0;
    return NextResponse.json({
      ok: true,
      data: { onboarded: Boolean(workspaceId) && brandCount > 0, workspaceId, brandCount },
    });
  });
}

