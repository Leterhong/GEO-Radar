import { prisma } from "@/server/db/client";
import { parseBody, withReadAuth, withWriteAuth } from "@/server/api/helpers";
import { NextResponse } from "next/server";
import { z } from "zod";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";


const createSchema = z.object({
  title: z.string().trim().max(100).optional(),
  mode: z.enum(["SEARCH_ANSWER", "SEARCH_EVIDENCE", "GEO_ANALYSIS"]).optional(),
});

export async function GET(request: Request) {
  return withReadAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    const search = url.searchParams.get("search") ?? undefined;
    const favoriteOnly = url.searchParams.get("favorite") === "true";
    const conversations = await prisma.conversation.findMany({
      where: {
        workspaceId,
        archivedAt: null,
        ...(favoriteOnly ? { isFavorite: true } : {}),
        ...(search ? { title: { contains: search, mode: "insensitive" } } : {}),
      },
      orderBy: [{ isFavorite: "desc" }, { updatedAt: "desc" }],
      take: 100,
      include: {
        messages: { orderBy: { createdAt: "asc" }, take: 1, select: { content: true } },
      },
    });
    return {
      conversations: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        currentMode: c.currentMode,
        isFavorite: c.isFavorite,
        updatedAt: c.updatedAt.toISOString(),
        preview: c.messages[0]?.content?.slice(0, 60) ?? "",
      })),
    };
  });
}

/** 新建会话。不调用任何搜索或模型。 */
export async function POST(request: Request) {
  return withWriteAuth(async ({ workspaceId, user }) => {
    type CreateBody = { title?: string; mode?: "SEARCH_ANSWER" | "SEARCH_EVIDENCE" | "GEO_ANALYSIS" };
    const body = (await parseBody(request, createSchema.partial().passthrough())
      .catch(() => null)) as CreateBody | null;
    const safeBody: CreateBody = body ?? {};
    const conversation = await prisma.conversation.create({
      data: {
        workspaceId,
        userId: user.id,
        title: safeBody.title?.trim() || "新对话",
        currentMode: safeBody.mode ?? "SEARCH_ANSWER",
      },
    });
    return NextResponse.json({
      ok: true,
      data: { id: conversation.id, title: conversation.title, currentMode: conversation.currentMode },
    });
  });
}
