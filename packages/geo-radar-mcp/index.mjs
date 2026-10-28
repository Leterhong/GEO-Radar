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

const transport = new StdioServerTransport();
await server.connect(transport);
