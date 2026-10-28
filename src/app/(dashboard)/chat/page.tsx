import { prisma } from "@/server/db/client";
import { requireWorkspace } from "@/server/auth/guard";
import { getMaskedCredentialConfig } from "@/server/services/provider-credential-service";
import { getMaskedModelConfig } from "@/server/services/model-credential-service";
import { ChatWorkspace } from "@/components/chat/chat-workspace";
import type { ChatMode } from "@/components/chat/mode-selector";

export const dynamic = "force-dynamic";
export const metadata = { title: "对话工作台" };

export default async function ChatPage() {
  const { workspaceId } = await requireWorkspace();
  const [brands, searchConfig, modelConfig, conversations] = await Promise.all([
    prisma.brand.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    getMaskedCredentialConfig(workspaceId),
    getMaskedModelConfig(workspaceId),
    prisma.conversation.findMany({
      where: { workspaceId, archivedAt: null },
      orderBy: [{ isFavorite: "desc" }, { updatedAt: "desc" }],
      take: 100,
      select: { id: true, title: true, currentMode: true, isFavorite: true, updatedAt: true },
    }),
  ]);

  return (
    <div className="-my-6 -mx-4 lg:-mx-8">
      <ChatWorkspace
        brands={brands}
        searchConfigured={searchConfig.status === "CONNECTED" && searchConfig.globallyEnabled}
        modelConfigured={modelConfig.configured && modelConfig.status !== "DISABLED"}
        initialConversations={conversations.map((c) => ({
          id: c.id,
          title: c.title,
          currentMode: c.currentMode as ChatMode,
          isFavorite: c.isFavorite,
          updatedAt: c.updatedAt.toISOString(),
          preview: "",
        }))}
      />
    </div>
  );
}
