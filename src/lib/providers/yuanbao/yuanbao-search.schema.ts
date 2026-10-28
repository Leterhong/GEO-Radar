import { z } from "zod";

// —— 元宝搜索 SearchPro 参数校验（依据官方文档 product/1806/121811）——
// 极速版（lite）不支持 Mode / Cnt / Industry；Deeplinks 仅旗舰版支持。
// 供应商能力差异在保存/执行时提示，不做静态假设。

export const YUANBAO_CNT_VALUES = [10, 20, 30, 40, 50] as const;
export const YUANBAO_INDUSTRY_VALUES = ["gov", "news", "acad", "finance"] as const;
export const YUANBAO_MODE_VALUES = [0, 1, 2] as const;

export const yuanbaoQuerySchema = z
  .string()
  .trim()
  .min(1, "搜索关键词不能为空")
  .max(200, "搜索关键词过长（最多 200 字符）");

const DOMAIN_RE = /^(?=.{1,253}$)(?!-)([a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,63}$/;

export function validateDomainLabel(domain: string): boolean {
  return DOMAIN_RE.test(domain);
}

/**
 * Site 参数：指定网址搜索（单个域名）或排除网站（exclude:a|b|c，最多 5 个）。
 * 与 Mode 共用时仅对公开网页信源结果生效。
 */
export function validateSiteInput(site: string): { ok: true; normalized: string } | { ok: false; error: string } {
  const trimmed = site.trim();
  if (!trimmed) return { ok: false, error: "Site 参数不能为空" };
  if (trimmed.toLowerCase().startsWith("exclude:")) {
    const domains = trimmed.slice("exclude:".length).split("|").map((d) => d.trim()).filter(Boolean);
    if (domains.length === 0) return { ok: false, error: "排除网站列表不能为空" };
    if (domains.length > 5) return { ok: false, error: "排除网站最多支持 5 个域名" };
    for (const d of domains) {
      if (!validateDomainLabel(d)) return { ok: false, error: `排除域名格式不正确：${d}` };
    }
    return { ok: true, normalized: `exclude:${domains.join("|")}` };
  }
  if (!validateDomainLabel(trimmed)) {
    return { ok: false, error: `指定网站域名格式不正确：${trimmed}` };
  }
  return { ok: true, normalized: trimmed };
}

function isValidCalendarDate(text: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // 防止 2024-02-31 这类日期被 Date 自动进位
  if (d.toISOString().slice(0, 10) !== text) return null;
  return d;
}

const MIN_DATE = "1970-01-01";

/**
 * Freshness 参数（五种形态不可混合）：
 * - d[N] 最近 N 天（1-30，空默认 1）
 * - m[N] 最近 N 月（1-12）
 * - y[N] 最近 N 年（1-5）
 * - yyyy-mm-dd 指定某日（不早于 1970-01-01，不晚于当天）
 * - yyyy-mm-dd,yyyy-mm-dd 日期区间（区间含 A、B，日期 B 不得晚于 A）
 */
export function validateFreshnessInput(
  freshness: string
): { ok: true; normalized: string } | { ok: false; error: string } {
  const value = freshness.trim();
  if (!value) return { ok: false, error: "Freshness 参数不能为空" };
  if (/^d([1-9]|[12]\d|30)$/.test(value)) return { ok: true, normalized: value };
  if (/^m([1-9]|1[0-2])$/.test(value)) return { ok: true, normalized: value };
  if (/^y[1-5]$/.test(value)) return { ok: true, normalized: value };
  const today = new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = isValidCalendarDate(value);
    if (!d) return { ok: false, error: `日期无效：${value}` };
    if (value < MIN_DATE) return { ok: false, error: "指定日期不能早于 1970-01-01" };
    if (value > today) return { ok: false, error: "指定日期不能晚于当天" };
    return { ok: true, normalized: value };
  }
  if (/^\d{4}-\d{2}-\d{2},\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parts = value.split(",");
    const a = parts[0];
    const b = parts[1];
    if (!a || !b) return { ok: false, error: `日期区间无效：${value}` };
    const da = isValidCalendarDate(a);
    const db = isValidCalendarDate(b);
    if (!da || !db) return { ok: false, error: `日期区间无效：${value}` };
    if (a < MIN_DATE) return { ok: false, error: "日期区间不能早于 1970-01-01" };
    if (a > today) return { ok: false, error: "日期区间不能晚于当天" };
    if (b > a) return { ok: false, error: "日期区间的结束日期 B 不得晚于起始日期 A（官方约束）" };
    return { ok: true, normalized: value };
  }
  return {
    ok: false,
    error:
      "Freshness 格式不正确：支持 d1-d30 / m1-m12 / y1-y5 / yyyy-mm-dd / yyyy-mm-dd,yyyy-mm-dd，五种形态不可混合",
  };
}

export const yuanbaoSearchParamsSchema = z.object({
  query: yuanbaoQuerySchema,
  mode: z
    .number()
    .int()
    .refine((v): v is 0 | 1 | 2 => (YUANBAO_MODE_VALUES as readonly number[]).includes(v), {
      message: "Mode 仅支持 0（公开网页信源）/ 1（优质权威垂直信源）/ 2（混合）",
    })
    .optional(),
  site: z.string().max(500).optional(),
  maxResults: z
    .number()
    .int()
    .refine((v): v is 10 | 20 | 30 | 40 | 50 => (YUANBAO_CNT_VALUES as readonly number[]).includes(v), {
      message: "返回条数 Cnt 仅支持 10/20/30/40/50",
    })
    .optional(),
  industry: z.enum(YUANBAO_INDUSTRY_VALUES).optional(),
  freshness: z.string().max(30).optional(),
  deeplinks: z.boolean().optional(),
});
export type YuanbaoSearchParams = z.infer<typeof yuanbaoSearchParamsSchema>;

/**
 * 构造真实请求体：没有必要的参数不发送；
 * Site/Freshness 需要二次校验（含官方约束）。
 */
export function buildYuanbaoRequestBody(
  params: YuanbaoSearchParams
): { body: Record<string, unknown> } | { error: string } {
  const body: Record<string, unknown> = { Query: params.query };
  if (params.mode !== undefined) body.Mode = params.mode;
  if (params.maxResults !== undefined) body.Cnt = params.maxResults;
  if (params.industry !== undefined) body.Industry = params.industry;
  if (params.site !== undefined && params.site !== "") {
    const site = validateSiteInput(params.site);
    if (!site.ok) return { error: site.error };
    body.Site = site.normalized;
  }
  if (params.freshness !== undefined && params.freshness !== "") {
    const freshness = validateFreshnessInput(params.freshness);
    if (!freshness.ok) return { error: freshness.error };
    body.Freshness = freshness.normalized;
  }
  if (params.deeplinks !== undefined) body.Deeplinks = params.deeplinks;
  return { body };
}

// —— 单条 Pages 结果字段校验：全部字段可选，类型不符按缺失处理 ——
export const yuanbaoPicSchema = z.object({
  caption: z.string().optional(),
  origin_url: z.string().optional(),
});

export const yuanbaoDeeplinkSchema = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
});

export const yuanbaoPageSchema = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  date: z.string().optional(),
  passage: z.string().optional(),
  content: z.string().optional(),
  site: z.string().optional(),
  score: z.number().min(0).max(1).optional(),
  authority_level: z.number().int().min(0).max(5).optional(),
  pics: z.array(yuanbaoPicSchema).optional(),
  favicon: z.string().optional(),
  deeplinks: z.array(yuanbaoDeeplinkSchema).optional(),
});
export type YuanbaoPage = z.infer<typeof yuanbaoPageSchema>;
