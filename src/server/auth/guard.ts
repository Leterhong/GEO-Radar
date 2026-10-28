import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { getCurrentUser, getActiveWorkspaceId } from "@/server/auth/session";
import type { User } from "@prisma/client";

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export interface WorkspaceContext {
  user: User;
  workspaceId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
}

export async function requireWorkspace(): Promise<WorkspaceContext> {
  const user = await requireUser();
  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) redirect("/onboarding");
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
  });
  if (!membership) redirect("/onboarding");
  return { user, workspaceId, role: membership.role };
}

export async function requireWorkspaceId(): Promise<{ userId: string; workspaceId: string }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) redirect("/onboarding");
  return { userId: user.id, workspaceId };
}
