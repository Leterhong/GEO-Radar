/** 域名规范化与比较：实现位于 src/lib/domain-utils.ts（纯函数，便于测试与复用）。 */
export {
  normalizeHostname,
  toRegistrableDomain,
  sameSite,
  extractWebsiteDomain,
  isSameOrSubdomain,
  isConfiguredOfficialHost,
} from "@/lib/domain-utils";
