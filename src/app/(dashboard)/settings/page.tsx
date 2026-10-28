import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/guard";
import { getActiveWorkspaceId } from "@/server/auth/session";
import { getMaskedCredentialConfig } from "@/server/services/provider-credential-service";
import { getMaskedModelConfig } from "@/server/services/model-credential-service";
import { SettingsClient } from "@/components/settings/settings-client";
import { PageHeader } from "@/components/shared/kpi-card";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const workspaceId = await getActiveWorkspaceId(user.id);
  const [config, modelConfig] = await Promise.all([
    workspaceId ? getMaskedCredentialConfig(workspaceId) : Promise.resolve(null),
    workspaceId ? getMaskedModelConfig(workspaceId) : Promise.resolve(null),
  ]);
  const workspaces = await prisma.workspaceMember.findMany({
    where: { userId: user.id },
    include: { workspace: { select: { id: true, name: true, createdAt: true } } },
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="设置" description="管理个人资料、工作空间与搜索/模型数据源连接。" />
      <SettingsClient
        user={{ name: user.name, email: user.email }}
        workspaces={workspaces.map((w) => ({
          id: w.workspace.id,
          name: w.workspace.name,
          role: w.role,
          isCurrent: w.workspace.id === workspaceId,
        }))}
        credential={config}
        modelCredential={modelConfig}
      />
    </div>
  );
}
