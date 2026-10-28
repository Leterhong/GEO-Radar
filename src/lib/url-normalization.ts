/**
 * URL 规范化（纯函数，可在服务端与测试中复用）。
 *
 * 设计原则：
 * 1. 原始 URL 永远由调用方保留，本函数只产出用于比较/去重的规范化结果；
 * 2. 只删除已知的跟踪参数，不删除可能决定页面内容的参数（id / q / page / lang / product 等）；
 * 3. 不把「同域名」当作「同页面」；同一域名下路径不同仍是不同页面；
 * 4. 无法解析的 URL 明确返回 valid=false，不做猜测或强行拼接。
 */

export const URL_NORMALIZATION_VERSION = "url-norm-v1";

/** 已知的纯跟踪参数（精确名，大小写不敏感）。刻意不包含 from / source / ref 等可能影响内容的参数。 */
const TRACKING_PARAMS = new Set([
  "gclid",
  "dclid",
  "fbclid",
  "msclkid",
  "yclid",
  "twclid",
  "ttclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
  "vero_id",
  "oly_anon_id",
  "oly_enc_id",
  "trk",
  "tracking_id",
  "pk_campaign",
  "pk_kwd",
  "piwik_campaign",
  "mtm_campaign",
  "mtm_source",
  "mtm_medium",
  "spm",
  "scm",
  "share_token",
  "share_source",
  "share_medium",
  "share_plat",
  "share_session_id",
  "share_tag",
  "share_from",
  "shareuserid",
  "ref_src",
  "ref_url",
  "unique_k",
  "si",
  "feature",
]);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMS.has(lower);
}

/** 解码百分号转义中的非保留字符，其余转义统一大写；不做完整 decode，避免破坏保留字符。 */
function normalizePercentEncoding(value: string): string {
  return value.replace(/%([0-9a-fA-F]{2})/g, (_match, hex: string) => {
    const char = String.fromCharCode(parseInt(hex, 16));
    if (/[A-Za-z0-9\-._~]/.test(char)) return char;
    return `%${hex.toUpperCase()}`;
  });
}

function safeDecodeForHost(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export interface NormalizedUrlResult {
  original: string;
  /** 解析失败时为 null；成功时为规范化 URL（不覆盖原始值） */
  normalized: string | null;
  valid: boolean;
  hostname: string | null;
  /** 页面路径（已规范化；不含 query） */
  path: string | null;
  /** 查询串（已排序、已移除跟踪参数） */
  query: string;
  removedParams: string[];
  keptParams: string[];
  /** 保留的 fragment（仅路由型 #/ 或 #! 保留；普通锚点被移除） */
  fragment: string | null;
  reason?: string;
}

/**
 * 规范化 URL。
 * - 协议/主机名小写，补全 https 协议；
 * - 移除默认端口（URL 解析器自动处理）；
 * - 移除普通锚点，保留 #/、#! 路由型 fragment；
 * - 去除非根路径的尾部斜杠；
 * - 移除已知跟踪参数，其余参数按键/值稳定排序；
 * - 统一百分号转义大小写并解码非保留字符。
 */
export function normalizeUrl(raw: string): NormalizedUrlResult {
  const original = typeof raw === "string" ? raw : "";
  const trimmed = original.trim();
  const base: NormalizedUrlResult = {
    original,
    normalized: null,
    valid: false,
    hostname: null,
    path: null,
    query: "",
    removedParams: [],
    keptParams: [],
    fragment: null,
  };
  if (trimmed === "") return { ...base, reason: "空 URL" };

  let candidate = trimmed;
  if (candidate.startsWith("//")) candidate = `https:${candidate}`;
  else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) candidate = `https://${candidate}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ...base, reason: "URL 无法解析" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ...base, reason: `不支持的协议 ${parsed.protocol}` };
  }
  if (parsed.hostname === "") return { ...base, reason: "URL 缺少主机名" };

  let hostname: string;
  try {
    hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    hostname = safeDecodeForHost(parsed.hostname).toLowerCase().replace(/\.$/, "");
  }
  if (hostname === "") return { ...base, reason: "URL 缺少有效主机名" };

  // 路径：空路径补 /；去掉非根路径尾部斜杠（文档化的保守规则）
  let path = parsed.pathname === "" ? "/" : parsed.pathname;
  path = normalizePercentEncoding(path);
  if (path.length > 1 && path.endsWith("/")) path = path.replace(/\/+$/, "") || "/";

  // Fragment：只有 SPA 路由型（#/ 或 #!）保留，其余（锚点）移除
  let fragment: string | null = null;
  if (parsed.hash && (parsed.hash.startsWith("#/") || parsed.hash.startsWith("#!/"))) {
    fragment = normalizePercentEncoding(parsed.hash);
  }

  // 查询参数：只删除明确跟踪参数；保持重复 key；排序保证顺序稳定
  const removedParams: string[] = [];
  const kept: Array<[string, string]> = [];
  const searchParams = parsed.searchParams;
  searchParams.forEach((value, key) => {
    if (isTrackingParam(key)) removedParams.push(key);
    else kept.push([key, value]);
  });
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const queryString = kept
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const query = queryString === "" ? "" : normalizePercentEncoding(queryString);

  const normalized = `${parsed.protocol}//${hostname}${path}${query ? `?${query}` : ""}${fragment ?? ""}`;
  return {
    original,
    normalized,
    valid: true,
    hostname,
    path,
    query,
    removedParams: Array.from(new Set(removedParams)),
    keptParams: kept.map(([key]) => key),
    fragment,
  };
}

/** 比较用的页面键：有效的用规范化 URL，无效的回退到原始 URL（不做跨页面合并）。 */
export function pageKeyOf(url: string): string {
  const result = normalizeUrl(url);
  return result.valid && result.normalized ? result.normalized : url.trim();
}
