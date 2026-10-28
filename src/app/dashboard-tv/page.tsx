import { requireUser } from "@/server/auth/guard";
import { getActiveWorkspaceId } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { redirect } from "next/navigation";
import { WallboardClient } from "@/components/wallboard/wallboard-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "GEO Radar 数据大屏" };

export default async function DashboardTvPage() {
  const user = await requireUser();
  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) redirect("/onboarding");
  const [brands, workspace] = await Promise.all([
    prisma.brand.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
  ]);
  return <WallboardClient brands={brands} workspaceName={workspace?.name ?? "工作空间"} />;
}
