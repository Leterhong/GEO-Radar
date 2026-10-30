import { prisma } from "@/server/db/client";
import { parseBody, apiFail, withReadAuth, withWriteAuth } from "@/server/api/helpers";
import { questionSchema } from "@/lib/validation/schemas";
import { publishQuestionSetVersion } from "@/server/services/question-set-service";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

// API 路由始终动态渲染（依赖会话 Cookie），避免构建期静态化尝试

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withReadAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    const questionSetId = url.searchParams.get("questionSetId") ?? undefined;
    const search = url.searchParams.get("search") ?? undefined;
    const category = url.searchParams.get("category") ?? undefined;
    const enabled = url.searchParams.get("enabled");
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? "20")));
    const where: Prisma.QuestionWhereInput = {
      workspaceId,
      ...(questionSetId ? { questionSetId } : {}),
      ...(search ? { text: { contains: search, mode: "insensitive" } } : {}),
      ...(category ? { category } : {}),
      ...(enabled === "true" ? { enabled: true } : enabled === "false" ? { enabled: false } : {}),
    };
    const [total, questions] = await Promise.all([
      prisma.question.count({ where }),
      prisma.question.findMany({
        where,
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { questionSet: { select: { name: true } } },
      }),
    ]);
    return {
      questions: questions.map((question) => ({
        ...question,
        questionSetName: question.questionSet.name,
      })),
      total,
      page,
      pageSize,
      categories: await prisma.question.findMany({
        where: { workspaceId, category: { not: null } },
        distinct: ["category"],
        select: { category: true },
        orderBy: { category: "asc" },
      }),
    };
  });
}

export async function POST(request: Request) {
  return withWriteAuth(async ({ workspaceId, user }) => {
    const body = await parseBody(request, questionSchema);
    const set = await prisma.questionSet.findFirst({
      where: { id: body.questionSetId, workspaceId, archivedAt: null },
    });
    if (!set) return apiFail(404, "QUESTION_SET_NOT_FOUND", "问题集不存在、已归档或不属于当前工作空间。");
    const question = await prisma.question.create({
      data: {
        workspaceId,
        questionSetId: set.id,
        text: body.text,
        category: body.category || undefined,
        intent: body.intent || undefined,
        region: body.region || undefined,
        language: body.language || undefined,
        priority: body.priority ?? 3,
        enabled: body.enabled ?? true,
        version: set.currentVersion + 1,
      },
    });
    const version = await publishQuestionSetVersion(workspaceId, set.id, user.id, {
      changedQuestionIds: [question.id],
      note: "新增问题",
    });
    return NextResponse.json({ ok: true, data: { question, version } });
  });
}
