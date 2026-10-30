#!/usr/bin/env node
/**
 * MCP smoke test.
 *
 *   GEO_RADAR_URL=http://127.0.0.1:3000 \
 *   GEO_RADAR_TOKEN=gr_... \
 *   npm run smoke:mcp
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const url = process.env.GEO_RADAR_URL || "http://127.0.0.1:3000";
const token = process.env.GEO_RADAR_TOKEN;
if (!token) {
  console.error("GEO_RADAR_TOKEN is required");
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["packages/geo-radar-mcp/index.mjs"],
  env: {
    ...process.env,
    GEO_RADAR_URL: url,
    GEO_RADAR_TOKEN: token,
  },
});
const client = new Client({ name: "geo-radar-smoke", version: "0.1.0" }, { capabilities: {} });
await client.connect(transport);

const tools = await client.listTools();
const names = tools.tools.map((t) => t.name);
const required = [
  "geo_list_brands",
  "geo_get_matrix",
  "geo_get_evidence",
  "geo_compare_rounds",
  "geo_create_task",
  "geo_start_task",
  "geo_create_report",
  "geo_search_web",
  "geo_batch_search",
  "geo_list_evidence",
  "geo_search_evidence",
  "geo_analyze_brand",
  "geo_analyze_domain",
  "geo_compare_competitors",
  "geo_analyze_citations",
  "geo_generate_report",
  "geo_get_report",
  "geo_export_evidence_csv",
];
for (const name of required) {
  if (!names.includes(name)) throw new Error(`missing tool: ${name}`);
}
console.log("TOOLS", names.length);

const brands = await client.callTool({ name: "geo_list_brands", arguments: {} });
const brandJson = JSON.parse(brands.content?.[0]?.text || "[]");
if (!Array.isArray(brandJson) || brandJson.length === 0) throw new Error("no brands returned");
console.log("BRANDS", brandJson.length);

const brandId = brandJson[0].id;
const matrix = await client.callTool({ name: "geo_get_matrix", arguments: { brandId, includeMock: true } });
const matrixJson = JSON.parse(matrix.content?.[0]?.text || "{}");
console.log("MATRIX_TASK", matrixJson.selectedTaskId ?? "none");
console.log("MATRIX_METRICS", matrixJson.dataset?.metrics?.length ?? 0);

const analysis = await client.callTool({ name: "geo_analyze_brand", arguments: { brandId, days: 30 } });
if (analysis.isError) throw new Error("geo_analyze_brand failed");
console.log("ANALYZE_BRAND_OK");

const evidence = await client.callTool({ name: "geo_list_evidence", arguments: { brandId, pageSize: 3 } });
if (evidence.isError) throw new Error("geo_list_evidence failed");
const evidenceJson = JSON.parse(evidence.content?.[0]?.text || "{}");
console.log("EVIDENCE_SAMPLE", evidenceJson.evidence?.length ?? 0);

const competitors = await client.callTool({ name: "geo_compare_competitors", arguments: { brandId, days: 30 } });
if (competitors.isError) throw new Error("geo_compare_competitors failed");
console.log("COMPARE_COMPETITORS_OK");

await client.close();
console.log("MCP SMOKE PASSED");
