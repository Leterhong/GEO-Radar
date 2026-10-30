#!/usr/bin/env node
/**
 * Actual MCP CSV export smoke, including content mode and file mode.
 *
 * Required:
 *   GEO_RADAR_URL, GEO_RADAR_TOKEN, GEO_RADAR_EXPORT_DIR (absolute)
 *
 * PowerShell:
 *   $env:GEO_RADAR_EXPORT_DIR=(Resolve-Path .tmp-export-test).Path
 *   npm run smoke:mcp:export
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const exportDir = process.env.GEO_RADAR_EXPORT_DIR;
if (!exportDir) throw new Error("GEO_RADAR_EXPORT_DIR is required");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["packages/geo-radar-mcp/index.mjs"],
  env: { ...process.env, GEO_RADAR_EXPORT_DIR: exportDir },
});
const client = new Client({ name: "geo-radar-export-smoke", version: "0.1.0" }, { capabilities: {} });
await client.connect(transport);
const meta = (result) => JSON.parse(result.content?.[0]?.text || "{}");
const fileCall = await client.callTool({
  name: "geo_export_evidence_csv",
  arguments: { brand: "元宝", limit: 5, outputMode: "file", filename: "geo-test.csv" },
});
if (fileCall.isError) throw new Error(`file export failed: ${fileCall.content?.[0]?.text}`);
const fileMeta = meta(fileCall);
const csv = await readFile(fileMeta.path, "utf8");
if (!csv.startsWith("\uFEFF")) throw new Error("file CSV missing BOM");
if (!csv.split(/\r?\n/)[0].includes("evidence_id")) throw new Error("file CSV missing header");
if (!csv.includes("元宝")) throw new Error("file CSV missing Chinese data");

const again = meta(await client.callTool({
  name: "geo_export_evidence_csv",
  arguments: { brand: "元宝", limit: 1, outputMode: "file", filename: "geo-test.csv" },
}));
if (again.path === fileMeta.path) throw new Error("second export overwrote the first file");

const traversal = await client.callTool({
  name: "geo_export_evidence_csv",
  arguments: { outputMode: "file", filename: "../escape.csv" },
});
if (!traversal.isError) throw new Error("path traversal filename was accepted");

const outside = await client.callTool({
  name: "geo_export_evidence_csv",
  arguments: { outputMode: "file", outputDirectory: resolve(exportDir, "..") },
});
if (!outside.isError) throw new Error("outputDirectory outside root was accepted");

const content = await client.callTool({
  name: "geo_export_evidence_csv",
  arguments: { limit: 1 },
});
if (content.isError) throw new Error(`content export failed: ${content.content?.[0]?.text}`);
const contentMeta = meta(content);
const contentCsv = content.content?.[1]?.text;
if (contentMeta.outputMode !== "content" || !contentCsv?.startsWith("\uFEFF")) throw new Error("content mode changed");

const empty = meta(await client.callTool({
  name: "geo_export_evidence_csv",
  arguments: { query: "zzzxqv-never-indexed-export", outputMode: "file", filename: "empty.csv" },
}));
if (empty.rowHint !== 0) throw new Error(`expected empty result, got ${empty.rowHint} rows`);

const overLimit = await client.callTool({
  name: "geo_export_evidence_csv",
  arguments: { limit: 1001 },
});
if (!overLimit.isError) throw new Error("limit above max was accepted");

console.log(JSON.stringify({
  file: { filename: fileMeta.filename, path: fileMeta.path, bytes: fileMeta.bytes, rows: fileMeta.rowHint },
  secondFile: { filename: again.filename, path: again.path },
  traversalRejected: traversal.isError,
  outsideRejected: outside.isError,
  content: { bytes: contentMeta.bytes, rows: contentMeta.rowHint },
  emptyFile: { rows: empty.rowHint, bytes: empty.bytes },
  overLimitRejected: overLimit.isError,
  result: "MCP CSV EXPORT PASSED",
}, null, 2));
await client.close();
