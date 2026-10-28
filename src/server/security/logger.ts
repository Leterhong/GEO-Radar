// 服务端日志工具：任何写入日志的内容先经过密钥脱敏。
// 已知密钥值（解密后的 API Key）通过 redactSecrets 注册到当前请求上下文。

const registeredSecrets = new Set<string>();

export function registerSecret(value: string | null | undefined): void {
  if (value && value.length >= 6) registeredSecrets.add(value);
}

export function clearRegisteredSecrets(): void {
  registeredSecrets.clear();
}

export function redact(text: string): string {
  let output = text;
  for (const secret of registeredSecrets) {
    output = output.split(secret).join("[REDACTED]");
  }
  // 兜底：常见 Bearer 头形态
  output = output.replace(/Bearer\s+[A-Za-z0-9._\-]{6,}/g, "Bearer [REDACTED]");
  return output;
}

type LogLevel = "info" | "warn" | "error";

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const line = `[${level}] ${redact(message)}`;
  const metaLine = meta ? ` ${redact(safeStringify(meta))}` : "";
  if (level === "error") console.error(line + metaLine);
  else if (level === "warn") console.warn(line + metaLine);
  else console.log(line + metaLine);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => emit("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit("error", message, meta),
};
