import { prisma } from "@/server/db/client";
import { apiFail, writeAuditLog, withReadAuth, withWriteAuth } from "@/server/api/helpers";
import { parseCsv, sanitizeCsvInput } from "@/lib/csv";
import { publishQuestionSetVersion } from "@/server/services/question-set-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface ImportRowError {
  row: number;
  reason: string;
  text?: string;
}

/** CSV 批量导入问题：先校验全部行，再统一写入；错误行逐一报告，不静默跳过。 */
export async function POST(request: Request) {
  return withWriteAuth(async ({ workspaceId, user }) => {
    let body: { questionSetId?: string; csv?: string; text?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return apiFail(400, "INVALID_JSON", "请求体不是有效的 JSON。");
    }
    if (!body.questionSetId) return apiFail(400, "VALIDATION_ERROR", "请选择目标问题集。");
    const set = await prisma.questionSet.findFirst({ where: { id: body.questionSetId, workspaceId } });
    if (!set) return apiFail(404, "QUESTION_SET_NOT_FOUND", "问题集不存在或不属于当前工作空间。");

    // 支持两种来源：CSV 文本 或 每行一个问题的纯文本
    let candidates: Array<{ text: string; row: number; category?: string }> = [];
    if (typeof body.text === "string" && body.text.trim() !== "") {
      candidates = body.text
        .split(/\r?\n/)
        .map((t) => t.trim())
        .filter((t) => t !== "")
        .map((t, i) => ({ text: t, row: i + 1 }));
    } else if (typeof body.csv === "string" && body.csv.trim() !== "") {
      let csv: string;
      try {
        csv = sanitizeCsvInput(body.csv);
      } catch (error) {
        return apiFail(400, "CSV_TOO_LARGE", error instanceof Error ? error.message : "CSV 内容过大");
      }
      const parsed = parseCsv(csv);
      // 首行视为表头；识别 text/问题 列与 category/类别 列，找不到则用第一列
      const header = parsed.rows[0] ?? [];
      const textCol = header.findIndex((h) => ["text", "问题", "问题文本", "question"].includes(h.trim().toLowerCase()));
      const col = textCol >= 0 ? textCol : 0;
      const categoryCol = header.findIndex((h) => ["category", "类别", "问题类别", "分类"].includes(h.trim().toLowerCase()));
      parsed.rows.slice(1).forEach((row, idx) => {
        const value = (row[col] ?? "").trim();
        const category = categoryCol >= 0 ? (row[categoryCol] ?? "").trim() : "";
        if (value !== "") candidates.push({ text: value, row: idx + 2, category: category || undefined });
      });
    } else {
      return apiFail(400, "EMPTY_INPUT", "请提供 CSV 内容或问题列表。");
    }

    if (candidates.length > 500) {
      return apiFail(400, "TOO_MANY_ROWS", "单次导入最多 500 行，请拆分后重试。");
    }

    const errors: ImportRowError[] = [];
    const valid: Array<{ text: string; category?: string }> = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const text = candidate.text;
      if (text.length > 300) {
        errors.push({ row: candidate.row, reason: "超过 300 字符上限", text });
        continue;
      }
      if (seen.has(text)) {
        errors.push({ row: candidate.row, reason: "与本次导入中的其他问题重复", text });
        continue;
      }
      seen.add(text);
      valid.push({ text, category: candidate.category });
    }
    const validTexts = valid.map((v) => v.text);

    // 与库中已有问题去重
    const existing = validTexts.length
      ? await prisma.question.findMany({
          where: { workspaceId, questionSetId: set.id, text: { in: validTexts } },
          select: { text: true },
        })
      : [];
    const existingTexts = new Set(existing.map((e) => e.text));
    const toCreate = valid.filter((v) => !existingTexts.has(v.text));
    for (const v of valid) {
      if (existingTexts.has(v.text)) {
        const row = candidates.find((c) => c.text === v.text)?.row ?? 0;
        errors.push({ row, reason: "问题集中已存在相同问题", text: v.text });
      }
    }

    if (toCreate.length > 0) {
      await prisma.question.createMany({
        data: toCreate.map((v) => ({
          workspaceId,
          questionSetId: set.id,
          text: v.text,
          category: v.category || null,
        })),
      });
      const created = await prisma.question.findMany({
        where: { workspaceId, questionSetId: set.id, text: { in: toCreate.map((v) => v.text) } },
        select: { id: true },
      });
      await publishQuestionSetVersion(workspaceId, set.id, user.id, {
        changedQuestionIds: created.map((q) => q.id),
        note: `CSV/文本批量导入 ${toCreate.length} 个问题`,
      });
    }
    await writeAuditLog({
      workspaceId,
      userId: user.id,
      action: "QUESTIONS_IMPORTED",
      targetType: "QuestionSet",
      targetId: set.id,
      metadata: { created: toCreate.length, errors: errors.length },
    });
    return NextResponse.json({
      ok: true,
      data: { created: toCreate.length, skipped: errors.length, errors },
    });
  });
}

/** 导出问题列表为 CSV（仅限当前工作空间）。 */
export async function GET() {
  return withReadAuth(async ({ workspaceId }) => {
    const questions = await prisma.question.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      include: { questionSet: { select: { name: true } } },
    });
    const { serializeCsv } = await import("@/lib/csv");
    const csv = serializeCsv(
      ["text", "questionSet", "category", "priority", "enabled", "createdAt"],
      questions.map((q) => [
        q.text,
        q.questionSet.name,
        q.category ?? "",
        String(q.priority),
        q.enabled ? "true" : "false",
        q.createdAt.toISOString(),
      ])
    );
    await writeAuditLog({ workspaceId, action: "QUESTIONS_EXPORTED" });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="georadar-questions-${Date.now()}.csv"`,
      },
    });
  });
}
