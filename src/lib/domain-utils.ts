/**
 * 域名规范化与同站判定（纯函数）。
 * 不能靠字符串包含判断同站：example.com.evil.io 不属于 example.com。
 */

const MULTI_PART_TLDS = new Set([
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "edu.cn",
  "ac.cn",
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "co.jp",
  "or.jp",
  "ne.jp",
  "com.hk",
  "org.hk",
  "edu.hk",
  "com.tw",
  "org.tw",
  "edu.tw",
  "com.au",
  "net.au",
  "org.au",
  "co.kr",
  "or.kr",
  "com.sg",
  "com.br",
  "com.mx",
  "co.in",
  "co.nz",
]);

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

/** 提取可注册主域（registrable domain）。解析失败返回 null。 */
export function toRegistrableDomain(hostnameOrUrl: string): string | null {
  let hostname = hostnameOrUrl.trim().toLowerCase();
  if (hostname.includes("://")) {
    try {
      const parsed = new URL(hostnameOrUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      hostname = parsed.hostname;
    } catch {
      return null;
    }
  }
  hostname = normalizeHostname(hostname);
  if (hostname === "" || !hostname.includes(".")) return null;
  const parts = hostname.split(".");
  if (parts.length === 2) return hostname;
  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

/**
 * 判断 candidate 是否属于 brandDomain 同站：
 * 二者可注册主域一致且 candidate 为 brandDomain 本身或其子域名。
 */
export function sameSite(
  candidateHostname: string | null | undefined,
  brandHostname: string | null | undefined
): boolean {
  if (!candidateHostname || !brandHostname) return false;
  const candidate = normalizeHostname(candidateHostname);
  const brand = normalizeHostname(brandHostname);
  const candidateRoot = toRegistrableDomain(candidate);
  const brandRoot = toRegistrableDomain(brand);
  if (!candidateRoot || !brandRoot) return false;
  if (candidateRoot !== brandRoot) return false;
  return candidate === brand || candidate.endsWith(`.${brand}`) || brand.endsWith(`.${candidate}`);
}

/** 从用户输入的品牌官网 URL 提取规范化域名；非法输入返回 null。 */
export function extractWebsiteDomain(websiteUrl: string | null | undefined): string | null {
  if (!websiteUrl || websiteUrl.trim() === "") return null;
  const withScheme = websiteUrl.includes("://") ? websiteUrl.trim() : `https://${websiteUrl.trim()}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const hostname = normalizeHostname(parsed.hostname);
    return hostname !== "" && hostname.includes(".") ? hostname : null;
  } catch {
    return null;
  }
}

/** candidate 是否为 domain 本身或其子域名（不做 registrable-domain 推断）。 */
export function isSameOrSubdomain(candidate: string | null | undefined, domain: string | null | undefined): boolean {
  if (!candidate || !domain) return false;
  const host = normalizeHostname(candidate);
  const target = normalizeHostname(domain);
  if (!host || !target) return false;
  return host === target || host.endsWith(`.${target}`);
}

/**
 * 官网归属判定：主域同站，或命中用户显式登记的官方域名/子域名。
 * 显式登记允许不同主域的官方站点（例如集团另一域名），但仍要求精确/子域匹配，避免误判。
 */
export function isConfiguredOfficialHost(
  candidate: string | null | undefined,
  websiteDomain: string | null | undefined,
  officialSubdomains: string[] | null | undefined
): boolean {
  if (sameSite(candidate, websiteDomain)) return true;
  return (officialSubdomains ?? []).some((domain) => isSameOrSubdomain(candidate, domain));
}
