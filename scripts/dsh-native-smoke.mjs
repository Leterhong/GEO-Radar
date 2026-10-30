#!/usr/bin/env node
/**
 * Run GEO Radar native DSH tools through the real @deepseek-ai/dsh-tools
 * ToolRuntime (not just a fake ctx.tools.register list).
 *
 * This is a service-level execution test. It does not boot the full DSH Web UI.
 *
 * Setup:
 *   npm install --prefix .dsh-tools @deepseek-ai/dsh-tools@0.1.5-rc.3
 *   $env:DSH_TOOLS_DIR = (Resolve-Path .dsh-tools/node_modules).Path
 *   $env:GEO_RADAR_URL = "http://127.0.0.1:3000"
 *   $env:GEO_RADAR_TOKEN = "gr_..."
 *   node scripts/dsh-native-smoke.mjs
 *
 * Search uses MOCK only. No SearchPro quota is consumed.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const toolsDir = process.env.DSH_TOOLS_DIR;
if (!toolsDir) throw new Error("DSH_TOOLS_DIR is required (path to @deepseek-ai/dsh-tools node_modules directory).");
const baseUrl = process.env.GEO_RADAR_URL || "http://127.0.0.1:3000";
const token = process.env.GEO_RADAR_TOKEN;
if (!token) throw new Error("GEO_RADAR_TOKEN is required.");
const toolsRoot = resolve(toolsDir);
const { Context } = await import(pathToFileURL(join(toolsRoot, "@deepseek-ai/cordis/lib/index.js")).href);
const { ToolRuntime } = await import(pathToFileURL(join(toolsRoot, "@deepseek-ai/dsh-tools/lib/index.js")).href);

const pluginSource = resolve("packages/geo-radar-dsh/index.js");
const pluginCopy = join(toolsRoot, "geo-radar-native.test.mjs");
await copyFile(pluginSource, pluginCopy);
const plugin = await import(`${pathToFileURL(pluginCopy).href}?v=${Date.now()}`);

const ctx = new Context();
ctx.provide("systemPrompt", {
  tools() { return () => {}; },
  section() { return () => {}; },
  getSectionOrder() { return 0; },
});
const runtime = new ToolRuntime(ctx);
plugin.apply(ctx, { baseUrl, token });

const schemas = ctx.tools.schemas();
const names = schemas.map((s) => s.name).sort();
const calls = [];
async function call(name, args) {
  const start = Date.now();
  const result = await ctx.tools.execute({
    callId: `native-smoke-${name}-${Date.now()}`,
    name,
    arguments: args,
    signal: AbortSignal.timeout(30_000),
  });
  calls.push({
    tool: name,
    args,
    status: result.isError ? "error" : "ok",
    durationMs: Date.now() - start,
    summary: result.isError ? result.error?.message : summarize(result.value),
    errorCode: result.isError ? result.error?.code : undefined,
  });
  return result;
}
function summarize(value) {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (!value || typeof value !== "object") return String(value).slice(0, 100);
  const keys = Object.keys(value).slice(0, 8);
  return `object(${keys.join(",")})`;
}

const brands = await call("geo_analyze_brand", { days: 30 });
const evidence = await call("geo_list_evidence", { pageSize: 2 });
const search = await call("geo_search_web", {
  query: "AI 搜索助手有哪些",
  executionMode: "MOCK",
  maxResults: 10,
});
const invalid = await call("geo_analyze_domain", {});
const searchTaskId = !search.isError && search.value?.id ? search.value.id : null;

console.log(JSON.stringify({
  toolCount: names.length,
  tools: names,
  calls,
  searchTaskId,
  brandResultOk: !brands.isError,
  evidenceResultOk: !evidence.isError,
  invalidArgumentRejected: invalid.isError,
  note: "Service-level native execution; full DSH Web boot is a separate check.",
}, null, 2));

if (searchTaskId) {
  // Leave cleanup to the caller; print the id so the test can be audited.
  console.error(`MOCK task created: ${searchTaskId}`);
}
