#!/usr/bin/env node
/**
 * GEO Radar MCP server (stdio).
 *
 * Required:
 *   GEO_RADAR_URL=http://127.0.0.1:3000
 *   GEO_RADAR_TOKEN=gr_...
 *
 * It deliberately exposes *task creation* and *task start* as separate tools.
 * Real tasks require confirmReal=true, so an agent cannot silently spend money.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.GEO_RADAR_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const TOKEN = process.env.GEO_RADAR_TOKEN;

if (!TOKEN) {
  console.error("[geo-radar-mcp] GEO_RADAR_TOKEN is required");
  process.exit(1);
}

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // keep raw text below
  }
  if (!res.ok || json?.ok === false) {
    const message = json?.error?.message || text.slice(0, 500) || `HTTP ${res.status}`;
    throw new Error(`${res.status}: ${message}`);
  }
  return json?.data ?? json;
}

function text(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function errorResult(error) {
  return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
}

async function createAndRun({ name, queries, brandId, executionMode, maxResults, confirmReal, timeoutSeconds = 60 }) {
  if (!queries.length) throw new Error("At least one query is required.");
  if (executionMode === "REAL" && confirmReal !== true) {
    throw new Error("REAL search can consume paid quota. Ask the user for explicit approval, then pass confirmReal=true. Use MOCK for workflow tests.");
  }
  const task = await api("/api/search-tasks", {
    method: "POST",
    body: JSON.stringify({
      name: name || `Agent search ${new Date().toISOString().slice(0, 19)}`,
      brandId: brandId || undefined,
      questions: queries.map((query) => ({ text: query, category: "AGENT_SEARCH" })),
      executionMode,
      maxResults: maxResults ?? 10,
    }),
  });
  await api(`/api/search-tasks/${encodeURIComponent(task.id)}/start`, { method: "POST" });
  const deadline = Date.now() + Math.max(5, Math.min(120, timeoutSeconds)) * 1000;
  let detail;
  while (Date.now() < deadline) {
    detail = await api(`/api/search-tasks/${encodeURIComponent(task.id)}`);
    if (!["QUEUED", "RUNNING"].includes(detail.task.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return compactTask(detail.task, detail.items);
}

async function evidenceList(filters) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") q.set(key, String(value));
  }
  q.set("pageSize", String(filters.pageSize ?? 50));
  return api(`/api/evidence?${q.toString()}`);
}

function summarizeEvidence(rows) {
  const byDomain = new Map();
  const byPageType = new Map();
  const byRole = new Map();
  for (const row of rows) {
    byDomain.set(row.domain ?? "(unknown)", (byDomain.get(row.domain ?? "(unknown)") ?? 0) + 1);
    byPageType.set(row.pageType ?? "UNKNOWN", (byPageType.get(row.pageType ?? "UNKNOWN") ?? 0) + 1);
    byRole.set(row.sourceRole ?? "UNKNOWN", (byRole.get(row.sourceRole ?? "UNKNOWN") ?? 0) + 1);
  }
  const sortMap = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  return {
    sampleSize: rows.length,
    domains: sortMap(byDomain).slice(0, 10),
    pageTypes: sortMap(byPageType),
    sourceRoles: sortMap(byRole),
  };
}

function compactTask(task, items) {
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    provider: task.provider,
    executionMode: task.executionMode,
    brand: task.brand,
    questionSetVersion: task.questionSetVersion,
    totalItems: task.totalItems,
    successItems: task.successItems,
    failedItems: task.failedItems,
    emptyItems: task.emptyItems,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    failureReason: task.failureReason,
    items: (items || []).map((item) => ({
      id: item.id,
      question: item.questionText,
      status: item.status,
      resultCount: item.resultCount,
      durationMs: item.durationMs,
      providerRequestId: item.providerRequestId,
      error: item.error,
      errorCategory: item.errorCategory,
    })),
  };
}

const server = new McpServer(
  { name: "geo-radar", version: "0.1.0" },
  { instructions: "GEO Radar tools: inspect real Yuanbao evidence tasks, matrices, comparisons and reports." }
);

server.registerTool(
  "geo_list_brands",
  {
    description: "List brands in the current GEO Radar workspace. Start here to find a brandId.",
    inputSchema: {},
  },
  async () => {
    try {
      const data = await api("/api/brands");
      return text((data.brands || []).map((b) => ({ id: b.id, name: b.name, websiteDomain: b.websiteDomain, aliases: b.aliases })));
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.registerTool(
  "geo_list_question_sets",
  {
    description: "List fixed question sets (with version and question count) in the workspace.",
    inputSchema: {},
  },
  async () => {
    try {
      const data = await api("/api/question-sets");
      return text(data.questionSets || []);
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.registerTool(
  "geo_list_tasks",
  {
    description: "List recent search tasks, optionally filtered by brandId. Use this to find baseline/retest task IDs.",
    inputSchema: {
      brandId: z.string().optional(),
      status: z.enum(["QUEUED", "RUNNING", "COMPLETED", "PARTIAL_FAILED", "FAILED", "CANCELLED"]).optional(),
    },
  },
  async ({ brandId, status }) => {
    try {
      const q = new URLSearchParams({ pageSize: "20" });
      if (brandId) q.set("brandId", brandId);
      if (status) q.set("status", status);
      const data = await api(`/api/search-tasks?${q.toString()}`);
      return text(data.tasks || []);
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.registerTool(
  "geo_get_task",
  {
    description: "Get one task with per-question status, result counts, duration and RequestId.",
    inputSchema: { taskId: z.string() },
  },
  async ({ taskId }) => {
    try {
      const data = await api(`/api/search-tasks/${encodeURIComponent(taskId)}`);
      return text(compactTask(data.task, data.items));
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.registerTool(
  "geo_wait_for_task",
  {
    description: "Poll a task until it is no longer QUEUED/RUNNING or the timeout is reached.",
    inputSchema: { taskId: z.string(), timeoutSeconds: z.number().int().min(1).max(120).optional() },
  },
  async ({ taskId, timeoutSeconds = 45 }) => {
    const deadline = Date.now() + timeoutSeconds * 1000;
    try {
      let data;
      while (Date.now() < deadline) {
        data = await api(`/api/search-tasks/${encodeURIComponent(taskId)}`);
        if (!["QUEUED", "RUNNING"].includes(data.task.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      return text(compactTask(data.task, data.items));
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.registerTool(
  "geo_get_matrix",
  {
    description: "Get the brand question matrix for a task or the latest real round of a brand. Evidence array is omitted by default.",
    inputSchema: {
      brandId: z.string(),
      taskId: z.string().optional(),
      includeMock: z.boolean().optional(),
      includeEvidence: z.boolean().optional(),
    },
  },
  async ({ brandId, taskId, includeMock = false, includeEvidence = false }) => {
    try {
      const q = new URLSearchParams({ brandId, includeMock: String(includeMock) });
      if (taskId) q.set("taskId", taskId);
      const data = await api(`/api/matrix?${q.toString()}`);
      const dataset = data.dataset
        ? {
            task: data.dataset.task,
            counts: data.dataset.counts,
            metrics: data.dataset.metrics,
            questions: data.dataset.questions,
            pageTypeDistribution: data.dataset.pageTypeDistribution,
            evidence: includeEvidence ? data.dataset.evidence : undefined,
            evidenceOmitted: includeEvidence ? undefined : `${data.dataset.evidence?.length ?? 0} evidence rows omitted; set includeEvidence=true`,
            limitations: data.dataset.limitations,
          }
        : null;
      return text({ selectedTaskId: data.dataset?.task?.id ?? null, dataset, rounds: data.rounds, message: data.message });
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.registerTool(
  "geo_get_evidence",
  {
    description: "Get one page-level evidence row with raw result metadata and review history.",
    inputSchema: { evidenceId: z.string() },
  },
  async ({ evidenceId }) => {
    try {
      const data = await api(`/api/evidence/${encodeURIComponent(evidenceId)}`);
      return text(data.evidence);
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.registerTool(
  "geo_compare_rounds",
  {
    description: "Compare two real rounds (baseline vs retest): common questions, metric movement, page diff, quality and volatility.",
    inputSchema: { baselineTaskId: z.string(), retestTaskId: z.string() },
  },
  async ({ baselineTaskId, retestTaskId }) => {
    try {
      const q = new URLSearchParams({ baseline: baselineTaskId, retest: retestTaskId, includeSeries: "true" });
      const data = await api(`/api/comparisons?${q.toString()}`);
      return text(data.comparison);
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.registerTool(
  "geo_create_task",
  {
    description:
      "Create a search task in QUEUED state. This does NOT call the API. Use executionMode=MOCK unless the user explicitly asks for a real Yuanbao call.",
    inputSchema: {
      name: z.string(),
      brandId: z.string(),
      questionSetId: z.string().optional(),
      questionIds: z.array(z.string()).optional(),
      executionMode: z.enum(["MOCK", "REAL"]).optional(),
      maxResults: z.number().int().min(1).max(50).optional(),
    },
  },
  async ({ name, brandId, questionSetId, questionIds, executionMode = "MOCK", maxResults = 10 }) => {
    try {
      const task = await api("/api/search-tasks", {
        method: "POST",
        body: JSON.stringify({ name, brandId, questionSetId, questionIds, executionMode, maxResults }),
      });
      return text({ id: task.id, name: task.name, status: task.status, executionMode: task.executionMode, message: "Task created. Call geo_start_task only after confirming the execution mode/cost." });
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.registerTool(
  "geo_start_task",
  {
    description:
      "Start a QUEUED task. REAL tasks can consume paid API quota; pass confirmReal=true only after the user explicitly approved. MOCK is free.",
    inputSchema: { taskId: z.string(), confirmReal: z.boolean().optional() },
  },
  async ({ taskId, confirmReal = false }) => {
    try {
      const current = await api(`/api/search-tasks/${encodeURIComponent(taskId)}`);
      if (current.task.executionMode === "REAL" && confirmReal !== true) {
        return errorResult(new Error("This is a REAL task. Ask the user for explicit approval, then call again with confirmReal=true."));
      }
      const data = await api(`/api/search-tasks/${encodeURIComponent(taskId)}/start`, { method: "POST" });
      return text({ ...data, message: "Task accepted. Use geo_wait_for_task to poll progress." });
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.registerTool(
  "geo_create_report",
  {
    description: "Generate a frozen evidence-centered report for a REAL task, optionally comparing a baseline round. Mock tasks are rejected by the server.",
    inputSchema: { taskId: z.string(), compareTaskId: z.string().optional(), title: z.string().optional() },
  },
  async ({ taskId, compareTaskId, title }) => {
    try {
      const report = await api("/api/reports", {
        method: "POST",
        body: JSON.stringify({ taskId, compareTaskId, title }),
      });
      return text(report);
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.registerTool(
  "geo_get_report",
  {
    description: "Get a generated report by id. Returns metadata plus a short markdown preview by default; set includeMarkdown=true for the full report.",
    inputSchema: { reportId: z.string(), includeMarkdown: z.boolean().optional() },
  },
  async ({ reportId, includeMarkdown = false }) => {
    try {
      const data = await api(`/api/reports/${encodeURIComponent(reportId)}`);
      const report = data.report;
      if (includeMarkdown) return text(report);
      return text({
        ...report,
        markdown: undefined,
        snapshot: undefined,
        markdownPreview: report.markdown?.slice(0, 4000),
        markdownOmitted: report.markdown
          ? `${report.markdown.length} chars omitted; set includeMarkdown=true for the full report`
          : undefined,
        snapshotOmitted: report.snapshot ? "report snapshot omitted; set includeMarkdown=true for the full report" : undefined,
      });
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.registerTool(
  "geo_search_web",
  {
    description:
      "Run a real/MOCK Yuanbao web search for one query. Defaults to MOCK; REAL requires confirmReal=true. Creates a GEO Radar task, starts it and returns stored results/evidence. This never invents search results.",
    inputSchema: {
      query: z.string().min(1),
      brandId: z.string().optional(),
      executionMode: z.enum(["MOCK", "REAL"]).optional(),
      maxResults: z.number().int().min(1).max(50).optional(),
      confirmReal: z.boolean().optional(),
      timeoutSeconds: z.number().int().min(5).max(120).optional(),
    },
  },
  async ({ query, brandId, executionMode = "MOCK", maxResults = 10, confirmReal = false, timeoutSeconds = 60 }) => {
    try {
      const task = await createAndRun({
        name: `Agent search: ${query.slice(0, 80)}`,
        queries: [query],
        brandId,
        executionMode,
        maxResults,
        confirmReal,
        timeoutSeconds,
      });
      return text(task);
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.registerTool(
  "geo_batch_search",
  {
    description:
      "Run one real/MOCK task containing up to 10 queries. Defaults to MOCK; REAL requires confirmReal=true. Results are stored as a normal GEO Radar task.",
    inputSchema: {
      queries: z.array(z.string().min(1)).min(1).max(10),
      brandId: z.string().optional(),
      executionMode: z.enum(["MOCK", "REAL"]).optional(),
      maxResults: z.number().int().min(1).max(50).optional(),
      confirmReal: z.boolean().optional(),
      timeoutSeconds: z.number().int().min(5).max(120).optional(),
    },
  },
  async ({ queries, brandId, executionMode = "MOCK", maxResults = 10, confirmReal = false, timeoutSeconds = 60 }) => {
    try {
      const task = await createAndRun({
        name: `Agent batch search (${queries.length} queries)`,
        queries,
        brandId,
        executionMode,
        maxResults,
        confirmReal,
        timeoutSeconds,
      });
      return text(task);
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.registerTool(
  "geo_list_evidence",
  {
    description: "List stored page-level evidence in the workspace, newest first. Supports brand/domain/task/pageType/mentionStatus filters.",
    inputSchema: {
      brandId: z.string().optional(),
      domain: z.string().optional(),
      taskId: z.string().optional(),
      pageType: z.string().optional(),
      mentionStatus: z.string().optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
    },
  },
  async ({ brandId, domain, taskId, pageType, mentionStatus, pageSize = 50 }) => {
    try {
      const data = await evidenceList({ brandId, domain, taskId, pageType, mentionStatus, pageSize });
      return text({ total: data.total, page: data.page, pageSize: data.pageSize, evidence: data.evidence });
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.registerTool(
  "geo_search_evidence",
  {
    description: "Search stored evidence by text and optional brand/domain/date filters. This is evidence search, not a new web search.",
    inputSchema: {
      search: z.string().min(1),
      brandId: z.string().optional(),
      domain: z.string().optional(),
      since: z.string().optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
    },
  },
  async ({ search, brandId, domain, since, pageSize = 50 }) => {
    try {
      const data = await evidenceList({ search, brandId, domain, since, pageSize });
      return text({ total: data.total, evidence: data.evidence });
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.registerTool(
  "geo_analyze_brand",
  {
    description: "Analyze brand visibility from stored real evidence: mention rate, question coverage, official/third-party coverage, trend and sources. No model is called.",
    inputSchema: { brandId: z.string().optional(), days: z.number().int().min(1).max(365).optional() },
  },
  async ({ brandId, days = 30 }) => {
    try {
      const q = new URLSearchParams({ days: String(days) });
      if (brandId) q.set("brandId", brandId);
      const data = await api(`/api/analytics/overview?${q.toString()}`);
      return text({ metrics: data.metrics, trend: data.trend, sources: data.sources });
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.registerTool(
  "geo_analyze_domain",
  {
    description: "Analyze official-domain/page-type coverage from stored evidence for a brand. Returns aggregated page types and source roles; sample size is explicit.",
    inputSchema: { brandId: z.string(), pageSize: z.number().int().min(1).max(200).optional() },
  },
  async ({ brandId, pageSize = 100 }) => {
    try {
      const data = await evidenceList({ brandId, pageSize });
      return text({ totalEvidence: data.total, ...summarizeEvidence(data.evidence) });
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.registerTool(
  "geo_compare_competitors",
  {
    description: "Compare brand and competitor appearance rate using the same valid-question denominator. No model is called.",
    inputSchema: { brandId: z.string(), days: z.number().int().min(1).max(365).optional() },
  },
  async ({ brandId, days = 30 }) => {
    try {
      const data = await api(`/api/analytics/competitors?brandId=${encodeURIComponent(brandId)}&days=${days}`);
      return text(data);
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.registerTool(
  "geo_analyze_citations",
  {
    description: "Analyze which domains/page types are cited in stored evidence for a brand. Returns an explicit sample size.",
    inputSchema: { brandId: z.string(), pageSize: z.number().int().min(1).max(200).optional() },
  },
  async ({ brandId, pageSize = 100 }) => {
    try {
      const data = await evidenceList({ brandId, pageSize });
      return text({ totalEvidence: data.total, ...summarizeEvidence(data.evidence) });
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.registerTool(
  "geo_generate_report",
  {
    description: "Generate a frozen evidence report for a REAL task, optionally comparing a baseline task. Mock tasks are rejected by the server.",
    inputSchema: { taskId: z.string(), compareTaskId: z.string().optional(), title: z.string().optional() },
  },
  async ({ taskId, compareTaskId, title }) => {
    try {
      const report = await api("/api/reports", {
        method: "POST",
        body: JSON.stringify({ taskId, compareTaskId, title }),
      });
      return text(report);
    } catch (e) {
      return errorResult(e);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
