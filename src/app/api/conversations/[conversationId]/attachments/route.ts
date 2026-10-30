import { prisma } from "@/server/db/client";
import { apiFail, writeAuditLog, withReadAuth, withWriteAuth } from "@/server/api/helpers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Params = { params: { conversationId: string } };

const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_TEXT_CHARS = 200_000;

/** 支持的附件类型：仅对能可靠提取纯文本的格式声明支持 */
const SUPPORTED: Record<string, { label: string; extractor: (buf: Buffer) => string }> = {
  ".txt": { label: "text/plain", extractor: (buf) => buf.toString("utf8") },
  ".md": { label: "text/markdown", extractor: (buf) => buf.toString("utf8") },
  ".markdown": { label: "text/markdown", extractor: (buf) => buf.toString("utf8") },
  ".csv": { label: "text/csv", extractor: (buf) => buf.toString("utf8") },
};

export async function GET(_request: Request, { params }: Params) {
  return withReadAuth(async ({ workspaceId }) => {
    const conversation = await prisma.conversation.findFirst({
      where: { id: params.conversationId, workspaceId },
    });
    if (!conversation) return apiFail(404, "NOT_FOUND", "会话不存在或不属于当前工作空间。");
    const attachments = await prisma.conversationAttachment.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        parseStatus: true,
        parseError: true,
        createdAt: true,
      },
    });
    return {
      attachments: attachments.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    };
  });
}

/**
 * 上传附件：服务端提取纯文本并保存（不保存二进制）。
 * 仅支持 TXT / Markdown / CSV——PDF 与 DOCX 需要专业解析库，当前明确不支持，不会假装已解析。
 */
export async function POST(request: Request, { params }: Params) {
  return withWriteAuth(async ({ workspaceId, user }) => {
    const conversation = await prisma.conversation.findFirst({
      where: { id: params.conversationId, workspaceId },
    });
    if (!conversation) return apiFail(404, "NOT_FOUND", "会话不存在或不属于当前工作空间。");

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return apiFail(400, "INVALID_FORM", "请使用 multipart/form-data 上传文件。");
    }
    const file = form.get("file");
    if (!(file instanceof File)) return apiFail(400, "NO_FILE", "未收到文件。");
    if (file.size === 0) return apiFail(400, "EMPTY_FILE", "文件为空。");
    if (file.size > MAX_SIZE_BYTES) {
      return apiFail(400, "FILE_TOO_LARGE", `文件超过 ${Math.floor(MAX_SIZE_BYTES / 1024 / 1024)}MB 限制。`);
    }
    const lower = file.name.toLowerCase();
    const extIndex = lower.lastIndexOf(".");
    const ext = extIndex >= 0 ? lower.slice(extIndex) : "";
    const supported = SUPPORTED[ext];
    const isUnsupportedBinary = [".pdf", ".docx", ".doc"].includes(ext);
    if (!supported) {
      const errorMessage = isUnsupportedBinary
        ? `暂不支持解析 ${ext.toUpperCase()} 文件：当前环境未集成对应解析库，不会把文件名当作已解析内容。请先导出为 TXT 或 Markdown 后上传。`
        : `不支持的文件类型 ${ext || "(无扩展名)"}。当前支持 TXT / Markdown / CSV。`;
      const record = await prisma.conversationAttachment.create({
        data: {
          workspaceId,
          conversationId: conversation.id,
          filename: file.name.slice(0, 200),
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          parseStatus: "UNSUPPORTED",
          parseError: errorMessage.slice(0, 500),
        },
      });
      await writeAuditLog({
        workspaceId,
        userId: user.id,
        action: "ATTACHMENT_UPLOAD_REJECTED",
        targetType: "ConversationAttachment",
        targetId: record.id,
        metadata: { ext, sizeBytes: file.size },
      });
      return apiFail(415, "UNSUPPORTED_TYPE", errorMessage, { attachmentId: record.id });
    }

    let text: string;
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      text = supported.extractor(buffer);
    } catch {
      return apiFail(400, "PARSE_FAILED", "文件内容解析失败，请检查文件编码后重试。");
    }
    const trimmed = text.replace(/\u0000/g, "").trim();
    if (trimmed === "") return apiFail(400, "EMPTY_CONTENT", "文件没有可用的文本内容。");

    const attachment = await prisma.conversationAttachment.create({
      data: {
        workspaceId,
        conversationId: conversation.id,
        filename: file.name.slice(0, 200),
        mimeType: supported.label,
        sizeBytes: file.size,
        extractedText: trimmed.slice(0, MAX_TEXT_CHARS),
        parseStatus: "PARSED",
      },
    });
    await writeAuditLog({
      workspaceId,
      userId: user.id,
      action: "ATTACHMENT_UPLOADED",
      targetType: "ConversationAttachment",
      targetId: attachment.id,
      metadata: { sizeBytes: file.size, chars: Math.min(trimmed.length, MAX_TEXT_CHARS) },
    });
    return NextResponse.json({
      ok: true,
      data: {
        id: attachment.id,
        filename: attachment.filename,
        chars: Math.min(trimmed.length, MAX_TEXT_CHARS),
        truncated: trimmed.length > MAX_TEXT_CHARS,
      },
    });
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return withWriteAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    const attachmentId = url.searchParams.get("attachmentId");
    if (!attachmentId) return apiFail(400, "MISSING_ID", "请提供 attachmentId。");
    const attachment = await prisma.conversationAttachment.findFirst({
      where: { id: attachmentId, conversationId: params.conversationId, workspaceId },
    });
    if (!attachment) return apiFail(404, "NOT_FOUND", "附件不存在或不属于当前会话。");
    await prisma.conversationAttachment.delete({ where: { id: attachment.id } });
    return NextResponse.json({ ok: true, data: { deleted: true } });
  });
}
