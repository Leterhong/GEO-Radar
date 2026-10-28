import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { getCurrentUser, getActiveWorkspaceId } from "@/server/auth/session";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "首次配置" };

/**
 * 首次配置 / 完善品牌档案：
 * - 未登录 → /login
 * - 已有工作空间且有品牌 → /dashboard（不再显示任何"已完成初始化"错误）
 * - 其余情况展示表单（可跳过）
 */
export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const workspaceId = await getActiveWorkspaceId(user.id);
  if (workspaceId) {
    const brandCount = await prisma.brand.count({ where: { workspaceId } });
    if (brandCount > 0) redirect("/dashboard");
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });
    return <OnboardingForm mode="brand-setup" initialWorkspaceName={workspace?.name ?? ""} />;
  }
  return <OnboardingForm mode="full" />;
}
