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

await client.close();
console.log("MCP SMOKE PASSED");
