import { prisma } from "@/server/db/client";
import { parseBody, apiFail, writeAuditLog, withReadAuth, withWriteAuth } from "@/server/api/helpers";
import { questionSetSchema } from "@/lib/validation/schemas";
import { createInitialQuestionSetVersion, QuestionSetError } from "@/server/services/question-set-service";
import { NextResponse } from "next/server";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withReadAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const sets = await prisma.questionSet.findMany({
      where: { workspaceId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: { createdAt: "desc" },
      include: {
        questions: { where: { enabled: true }, select: { id: true } },
        versions: { orderBy: { version: "desc" }, take: 1, select: { version: true, createdAt: true } },
        _count: { select: { tasks: true } },
      },
    });
    return {
      questionSets: sets.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        questionCount: s.questions.length,
        currentVersion: s.currentVersion,
        latestVersion: s.versions[0]?.version ?? null,
        latestVersionAt: s.versions[0]?.createdAt ?? null,
        taskCount: s._count.tasks,
        archivedAt: s.archivedAt,
        createdAt: s.createdAt,
      })),
    };
  });
}

export async function POST(request: Request) {
  return withWriteAuth(async ({ workspaceId, user }) => {
    const body = await parseBody(request, questionSetSchema);
    try {
      const set = await prisma.$transaction(async (tx) => {
        const created = await tx.questionSet.create({
          data: { workspaceId, name: body.name, description: body.description || undefined },
        });
        await createInitialQuestionSetVersion(tx, created, [], user.id);
        return created;
      });
      await writeAuditLog({
        workspaceId,
        userId: user.id,
        action: "QUESTION_SET_CREATED",
        targetType: "QuestionSet",
        targetId: set.id,
      });
      return NextResponse.json({ ok: true, data: set });
    } catch (error) {
      if (error instanceof QuestionSetError) return apiFail(400, error.code, error.message);
      throw error;
    }
  });
}
