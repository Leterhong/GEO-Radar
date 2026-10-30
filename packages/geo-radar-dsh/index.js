/**
 * GEO Radar native DSH tools.
 *
 * The tools call the existing GEO Radar Core REST API. They do not implement
 * search, evidence matching or metric calculations a second time.
 */
import { defineTool } from "@deepseek-ai/dsh-tools";

export const name = "geo-radar-native";
export const inject = ["tools"];

function createClient(config = {}) {
  const base = (config.baseUrl || process.env.GEO_RADAR_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
  const token = config.token || process.env.GEO_RADAR_TOKEN;
  if (!token) throw new Error("GEO_RADAR_TOKEN is required for GEO Radar native tools.");
  async function api(path, init = {}) {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      signal: init.signal || AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (!res.ok || json?.ok === false) {
      throw new Error(`${res.status}: ${json?.error?.message || text.slice(0, 300) || "request failed"}`);
    }
    return json?.data ?? json;
  }
  return { api, base };
}

const objectSchema = { type: "object", properties: {}, additionalProperties: true };
const textOutput = {
  schema: objectSchema,
  render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
};

function register(ctx, client, tool) {
  ctx.tools.register(defineTool({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    output: textOutput,
    async execute(args, exec) {
      return tool.execute(args, exec, client);
    },
  }));
}

async function startAndWait(client, taskId, timeoutSeconds = 60) {
  await client.api(`/api/search-tasks/${encodeURIComponent(taskId)}/start`, { method: "POST" });
  const deadline = Date.now() + Math.max(5, Math.min(120, timeoutSeconds)) * 1000;
  let detail;
  while (Date.now() < deadline) {
    detail = await client.api(`/api/search-tasks/${encodeURIComponent(taskId)}`);
    if (!["QUEUED", "RUNNING"].includes(detail.task.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return detail;
}

function compactTask(detail) {
  const task = detail.task;
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    provider: task.provider,
    executionMode: task.executionMode,
    successItems: task.successItems,
    failedItems: task.failedItems,
    emptyItems: task.emptyItems,
    failureReason: task.failureReason,
    items: (detail.items || []).map((item) => ({
      question: item.questionText,
      status: item.status,
      resultCount: item.resultCount,
      requestId: item.providerRequestId,
      error: item.error,
    })),
  };
}

async function createSearch(client, { name, queries, brandId, executionMode = "MOCK", maxResults = 10, confirmReal = false }) {
  if (executionMode === "REAL" && confirmReal !== true) {
    throw new Error("REAL search can consume paid quota. Pass confirmReal=true after explicit user approval.");
  }
  if (executionMode === "REAL" && ![10, 20, 30, 40, 50].includes(maxResults)) {
    throw new Error("Yuanbao SearchPro Cnt only supports 10/20/30/40/50.");
  }
  const task = await client.api("/api/search-tasks", {
    method: "POST",
    body: JSON.stringify({
      name: name || `DSH native search ${new Date().toISOString().slice(0, 19)}`,
      brandId: brandId || undefined,
      questions: queries.map((text) => ({ text, category: "DSH_NATIVE_SEARCH" })),
      executionMode,
      maxResults,
    }),
  });
  return startAndWait(client, task.id);
}

function summarizeEvidence(rows) {
  const group = (key) => {
    const map = new Map();
    for (const row of rows) {
      const value = row[key] || "UNKNOWN";
      map.set(value, (map.get(value) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  };
  return { sampleSize: rows.length, domains: group("domain"), pageTypes: group("pageType"), sourceRoles: group("sourceRole") };
}

export function apply(ctx, config = {}) {
  const client = createClient(config);
  const tools = [
    {
      name: "geo_search_web",
      description: "Search real/MOCK Yuanbao web results through GEO Radar. Defaults to MOCK; REAL requires confirmReal=true.",
      parameters: {
        query: { type: "string", required: true, description: "Search query" },
        brandId: { type: "string", description: "Optional brand ID" },
        executionMode: { type: "string", description: "MOCK or REAL" },
        maxResults: { type: "number", description: "10/20/30/40/50 for REAL" },
        confirmReal: { type: "boolean" },
      },
      execute: async (args, _exec, c) => compactTask(await createSearch(c, {
        name: `DSH search: ${args.query.slice(0, 70)}`,
        queries: [args.query],
        brandId: args.brandId,
        executionMode: args.executionMode || "MOCK",
        maxResults: args.maxResults || 10,
        confirmReal: args.confirmReal,
      })),
    },
    {
      name: "geo_batch_search",
      description: "Run up to 10 queries in one GEO Radar task. Defaults to MOCK; REAL requires confirmReal=true.",
      parameters: {
        queries: { type: "array", items: { type: "string" }, required: true },
        brandId: { type: "string" },
        executionMode: { type: "string" },
        maxResults: { type: "number" },
        confirmReal: { type: "boolean" },
      },
      execute: async (args, _exec, c) => compactTask(await createSearch(c, {
        queries: args.queries,
        brandId: args.brandId,
        executionMode: args.executionMode || "MOCK",
        maxResults: args.maxResults || 10,
        confirmReal: args.confirmReal,
      })),
    },
    {
      name: "geo_list_evidence",
      description: "List stored evidence with optional filters.",
      parameters: {
        brandId: { type: "string" },
        domain: { type: "string" },
        taskId: { type: "string" },
        pageType: { type: "string" },
        mentionStatus: { type: "string" },
        pageSize: { type: "number" },
      },
      execute: async (args, _exec, c) => {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(args)) if (v !== undefined && v !== "") q.set(k, String(v));
        q.set("pageSize", String(args.pageSize || 50));
        return c.api(`/api/evidence?${q.toString()}`);
      },
    },
    {
      name: "geo_get_evidence",
      description: "Get one evidence row with raw metadata and reviews.",
      parameters: { evidenceId: { type: "string", required: true } },
      execute: async (args, _exec, c) => (await c.api(`/api/evidence/${encodeURIComponent(args.evidenceId)}`)).evidence,
    },
    {
      name: "geo_analyze_brand",
      description: "Read brand visibility metrics, trend and sources from stored evidence.",
      parameters: { brandId: { type: "string" }, days: { type: "number" } },
      execute: async (args, _exec, c) => {
        const q = new URLSearchParams({ days: String(args.days || 30) });
        if (args.brandId) q.set("brandId", args.brandId);
        return c.api(`/api/analytics/overview?${q.toString()}`);
      },
    },
    {
      name: "geo_analyze_domain",
      description: "Aggregate official/third-party/page-type coverage from evidence.",
      parameters: { brandId: { type: "string", required: true }, pageSize: { type: "number" } },
      execute: async (args, _exec, c) => {
        const data = await c.api(`/api/evidence?brandId=${encodeURIComponent(args.brandId)}&pageSize=${args.pageSize || 100}`);
        return { totalEvidence: data.total, ...summarizeEvidence(data.evidence || []) };
      },
    },
    {
      name: "geo_compare_competitors",
      description: "Compare brand and competitors using the same valid-question denominator.",
      parameters: { brandId: { type: "string", required: true }, days: { type: "number" } },
      execute: async (args, _exec, c) => c.api(`/api/analytics/competitors?brandId=${encodeURIComponent(args.brandId)}&days=${args.days || 30}`),
    },
    {
      name: "geo_analyze_citations",
      description: "Aggregate cited domains/page types from stored evidence.",
      parameters: { brandId: { type: "string", required: true }, pageSize: { type: "number" } },
      execute: async (args, _exec, c) => {
        const data = await c.api(`/api/evidence?brandId=${encodeURIComponent(args.brandId)}&pageSize=${args.pageSize || 100}`);
        return { totalEvidence: data.total, ...summarizeEvidence(data.evidence || []) };
      },
    },
    {
      name: "geo_generate_report",
      description: "Generate a frozen report for a REAL task, optionally comparing a baseline.",
      parameters: { taskId: { type: "string", required: true }, compareTaskId: { type: "string" }, title: { type: "string" } },
      execute: async (args, _exec, c) => c.api("/api/reports", {
        method: "POST",
        body: JSON.stringify({ taskId: args.taskId, compareTaskId: args.compareTaskId, title: args.title }),
      }),
    },
  ];
  for (const tool of tools) register(ctx, client, tool);
}
