import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/guard";
import { getActiveWorkspaceId } from "@/server/auth/session";
import { SidebarNav } from "@/components/layout/sidebar";
import { DashboardHeader } from "@/components/layout/header";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const activeWorkspaceId = await getActiveWorkspaceId(user.id);
  const [workspaces, credential, modelCredential] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { userId: user.id },
      include: { workspace: { select: { id: true, name: true } } },
      orderBy: { joinedAt: "asc" },
    }),
    activeWorkspaceId
      ? prisma.searchProviderCredential.findUnique({ where: { workspaceId: activeWorkspaceId } })
      : null,
    activeWorkspaceId
      ? prisma.modelProviderCredential.findUnique({ where: { workspaceId: activeWorkspaceId } })
      : null,
  ]);
  const workspaceList = workspaces.map((w) => ({ id: w.workspace.id, name: w.workspace.name }));

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[236px] border-r border-border lg:block">
        <SidebarNav />
      </aside>
      <div className="flex min-h-screen w-full flex-col lg:pl-[236px]">
        <DashboardHeader
          userEmail={user.email}
          userName={user.name}
          workspaces={workspaceList}
          activeWorkspaceId={activeWorkspaceId ?? ""}
          credentialStatus={credential?.status ?? "NOT_CONFIGURED"}
          modelConfigured={
            Boolean(modelCredential?.encryptedSecret) && modelCredential?.status !== "DISABLED"
          }
        />
        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-7">{children}</main>
      </div>
    </div>
  );
}
