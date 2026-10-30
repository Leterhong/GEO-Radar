// 轻量 CSV 解析/序列化（RFC 4180 常用子集）：支持引号字段、逗号、换行转义。

export interface CsvParseError {
  line: number; // 1-based 物理行（近似）
  reason: string;
}

export interface CsvParseResult {
  rows: string[][];
  errors: CsvParseError[];
}

export function parseCsv(text: string): CsvParseResult {
  const rows: string[][] = [];
  const errors: CsvParseError[] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let physicalLine = 1;
  let sawAnyChar = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    sawAnyChar = true;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          currentField += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") physicalLine += 1;
        currentField += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      currentRow.push(currentField);
      currentField = "";
    } else if (ch === "\n") {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = "";
      physicalLine += 1;
    } else if (ch === "\r") {
      // 忽略 CR（跟随的 LF 已处理）
    } else {
      currentField += ch;
    }
  }
  if (inQuotes) {
    errors.push({ line: physicalLine, reason: "引号未闭合" });
  }
  if (sawAnyChar && (currentField !== "" || currentRow.length > 0)) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }
  return { rows, errors };
}

export function csvEscape(value: string): string {
  // CSV formula injection mitigation: prefix risky leading characters.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function serializeCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(row.map((cell) => csvEscape(cell ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}

/** 去除 BOM 与多余空白；限制输入大小。 */
export function sanitizeCsvInput(text: string, maxBytes = 512 * 1024): string {
  if (text.length > maxBytes) {
    throw new Error(`CSV 内容过大（超过 ${Math.floor(maxBytes / 1024)}KB），请拆分后导入`);
  }
  return text.replace(/^\uFEFF/, "");
}
