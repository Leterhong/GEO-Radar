import { prisma } from "@/server/db/client";
import { withReadAuth } from "@/server/api/helpers";
import { serializeCsv } from "@/lib/csv";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** 导出问题集为 CSV：用于备份、审阅和再用导入功能迁移。 */
export async function GET(request: Request) {
  return withReadAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    const questionSetId = url.searchParams.get("questionSetId") || undefined;
    const questions = await prisma.question.findMany({
      where: { workspaceId, ...(questionSetId ? { questionSetId } : {}) },
      orderBy: [{ questionSetId: "asc" }, { priority: "desc" }, { createdAt: "asc" }],
      include: { questionSet: { select: { name: true } } },
    });
    const csv = serializeCsv(
      ["question", "category", "priority", "enabled", "question_set"],
      questions.map((q) => [
        q.text,
        q.category ?? "",
        String(q.priority),
        q.enabled ? "true" : "false",
        q.questionSet.name,
      ])
    );
    return new NextResponse(`\uFEFF${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="geo-radar-questions-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  });
}
