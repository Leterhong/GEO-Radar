import { Prisma } from "@prisma/client";
import type { Schedule } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { writeAuditLog } from "@/server/api/helpers";
import { describeTiming, isValidTimeZone, nextRunAfter, type ScheduleFrequencyValue } from "@/lib/schedule-time";
import {
  createSearchTask,
  evaluateRealModeGuard,
  searchExecutionErrorCode,
  startSearchTask,
} from "@/server/services/search-execution";
import { ensureVersionForTask } from "./question-set-service";

/**
 * 定时采集。
 *
 * 可靠性边界（诚实说明）：
 * - 内置调度器由 instrumentation.ts 在当前 Node 进程内以固定间隔触发，仅适合单实例部署；
 *   多实例会重复触发（由 ScheduleRun(scheduleId, plannedAt) 唯一约束兜底），生产建议关闭内置调度器，
 *   改用外部 cron 调用 POST /api/schedules/tick（带 CRON_SECRET）。
 * - 任务执行仍在 Web 进程内进行；进程重启会中断正在执行的任务。
 * - 每次执行都创建真实的 SearchTask，不复用历史结果。
 */

export class ScheduleError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export interface CreateScheduleInput {
  name: string;
  brandId?: string;
  questionSetId: string;
  questionSetVersionId?: string;
  frequency: ScheduleFrequencyValue;
  timezone?: string;
  hour: number;
  minute: number;
  weekday?: number | null;
  executionMode: "REAL" | "MOCK";
  confirmedCost: boolean;
  params?: {
    maxResults?: number;
    mode?: number;
    industry?: "gov" | "news" | "acad" | "finance";
    freshness?: string;
    site?: string;
    deeplinks?: boolean;
  };
}

const VALID_TIMEZONE_FALLBACK = "Asia/Shanghai";

function validateTiming(input: {
  frequency: ScheduleFrequencyValue;
  timezone: string;
  hour: number;
  minute: number;
  weekday?: number | null;
}) {
  if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23) throw new ScheduleError("INVALID_TIME", "小时必须在 0-23 之间");
  if (!Number.isInteger(input.minute) || input.minute < 0 || input.minute > 59) throw new ScheduleError("INVALID_TIME", "分钟必须在 0-59 之间");
  if (!isValidTimeZone(input.timezone)) throw new ScheduleError("INVALID_TIMEZONE", `无效的时区：${input.timezone}`);
  if (input.frequency === "WEEKLY" && (!input.weekday || input.weekday < 1 || input.weekday > 7)) {
    throw new ScheduleError("INVALID_WEEKDAY", "每周采集必须指定 1-7 的星期");
  }
}

async function loadQuestionSetForSchedule(workspaceId: string, questionSetId: string) {
  const set = await prisma.questionSet.findFirst({
    where: { id: questionSetId, workspaceId, archivedAt: null },
  });
  if (!set) throw new ScheduleError("QUESTION_SET_NOT_FOUND", "问题集不存在、已归档或不属于当前工作空间");
  return set;
}

export async function createSchedule(
  workspaceId: string,
  userId: string,
  input: CreateScheduleInput
) {
  const timezone = input.timezone?.trim() || VALID_TIMEZONE_FALLBACK;
  validateTiming({ ...input, timezone });
  if (input.executionMode === "REAL") {
    if (!input.confirmedCost) {
      throw new ScheduleError("COST_NOT_CONFIRMED", "开启真实定时采集前，必须明确确认会产生额外 API 调用成本。");
    }
    const credential = await prisma.searchProviderCredential.findUnique({ where: { workspaceId } });
    const guard = evaluateRealModeGuard(credential);
    if (!guard.ok) throw new ScheduleError(guard.code ?? "PROVIDER_NOT_READY", guard.reason ?? "数据源未就绪");
  }

  const set = await loadQuestionSetForSchedule(workspaceId, input.questionSetId);
  if (input.brandId) {
    const brand = await prisma.brand.findFirst({ where: { id: input.brandId, workspaceId } });
    if (!brand) throw new ScheduleError("BRAND_NOT_FOUND", "品牌不存在或不属于当前工作空间");
  }

  const activeCount = await prisma.schedule.count({
    where: { workspaceId, status: "ACTIVE" },
  });
  if (activeCount >= env.scheduleMaxActivePerWorkspace) {
    throw new ScheduleError(
      "SCHEDULE_LIMIT",
      `每个工作空间最多启用 ${env.scheduleMaxActivePerWorkspace} 个排期，请先暂停或取消其他排期。`
    );
  }

  const version = input.questionSetVersionId
    ? await prisma.questionSetVersion.findFirst({
        where: { id: input.questionSetVersionId, questionSetId: set.id, workspaceId },
      })
    : await ensureVersionForTask(workspaceId, set.id, userId);
  if (!version) throw new ScheduleError("VERSION_NOT_FOUND", "指定的问题集版本不存在或不属于该问题集");

  const enabledCount = version.enabledCount;
  if (enabledCount === 0) throw new ScheduleError("NO_QUESTIONS", "问题集没有启用的问题，无法创建排期");
  if (enabledCount > env.scheduleMaxQuestions) {
    throw new ScheduleError(
      "TOO_MANY_QUESTIONS",
      `定时采集单轮最多 ${env.scheduleMaxQuestions} 个问题（当前 ${enabledCount} 个），请拆分问题集或调整上限。`
    );
  }

  const timing = {
    frequency: input.frequency,
    hour: input.hour,
    minute: input.minute,
    weekday: input.weekday ?? null,
    timezone,
  };
  const nextRunAt = nextRunAfter(new Date(), timing);

  const schedule = await prisma.schedule.create({
    data: {
      workspaceId,
      brandId: input.brandId,
      questionSetId: set.id,
      questionSetVersionId: version.id,
      name: input.name.trim(),
      frequency: input.frequency,
      timezone,
      hour: input.hour,
      minute: input.minute,
      weekday: input.weekday ?? null,
      executionMode: input.executionMode,
      params: (input.params ?? {}) as never,
      confirmedCost: input.confirmedCost,
      status: "ACTIVE",
      nextRunAt,
      createdById: userId,
    },
  });
  await writeAuditLog({
    workspaceId,
    userId,
    action: "SCHEDULE_CREATED",
    targetType: "Schedule",
    targetId: schedule.id,
    metadata: {
      frequency: input.frequency,
      timezone,
      executionMode: input.executionMode,
      nextRunAt: nextRunAt.toISOString(),
      questionSetVersionId: version.id,
      enabledCount,
    },
  });
  return { schedule, timingDescription: describeTiming(timing), enabledCount, nextRunAt };
}

export async function updateSchedule(
  workspaceId: string,
  userId: string,
  scheduleId: string,
  input: {
    name?: string;
    status?: "ACTIVE" | "PAUSED" | "CANCELLED";
    frequency?: ScheduleFrequencyValue;
    timezone?: string;
    hour?: number;
    minute?: number;
    weekday?: number | null;
    confirmedCost?: boolean;
    params?: CreateScheduleInput["params"];
  }
) {
  const existing = await prisma.schedule.findFirst({ where: { id: scheduleId, workspaceId } });
  if (!existing) throw new ScheduleError("SCHEDULE_NOT_FOUND", "排期不存在或不属于当前工作空间");

  const timezone = input.timezone?.trim() ?? existing.timezone;
  const frequency = (input.frequency ?? existing.frequency) as ScheduleFrequencyValue;
  const hour = input.hour ?? existing.hour;
  const minute = input.minute ?? existing.minute;
  const weekday = input.weekday !== undefined ? input.weekday : existing.weekday;
  validateTiming({ frequency, timezone, hour, minute, weekday });

  if (input.status === "ACTIVE" && existing.status !== "ACTIVE") {
    const activeCount = await prisma.schedule.count({ where: { workspaceId, status: "ACTIVE" } });
    if (activeCount >= env.scheduleMaxActivePerWorkspace) {
      throw new ScheduleError("SCHEDULE_LIMIT", `每个工作空间最多启用 ${env.scheduleMaxActivePerWorkspace} 个排期。`);
    }
  }

  const status = input.status ?? existing.status;
  const nextRunAt =
    status === "ACTIVE"
      ? nextRunAfter(new Date(), { frequency, hour, minute, weekday, timezone })
      : null;

  const updated = await prisma.schedule.update({
    where: { id: existing.id },
    data: {
      name: input.name?.trim(),
      status,
      frequency,
      timezone,
      hour,
      minute,
      weekday: weekday ?? null,
      confirmedCost: input.confirmedCost ?? existing.confirmedCost,
      params: input.params ? (input.params as never) : undefined,
      nextRunAt,
    },
  });
  await writeAuditLog({
    workspaceId,
    userId,
    action: "SCHEDULE_UPDATED",
    targetType: "Schedule",
    targetId: updated.id,
    metadata: { status, nextRunAt: nextRunAt?.toISOString() ?? null },
  });
  return updated;
}

export async function cancelSchedule(workspaceId: string, userId: string, scheduleId: string) {
  const existing = await prisma.schedule.findFirst({ where: { id: scheduleId, workspaceId } });
  if (!existing) throw new ScheduleError("SCHEDULE_NOT_FOUND", "排期不存在或不属于当前工作空间");
  const updated = await prisma.schedule.update({
    where: { id: existing.id },
    data: { status: "CANCELLED", nextRunAt: null },
  });
  await writeAuditLog({
    workspaceId,
    userId,
    action: "SCHEDULE_CANCELLED",
    targetType: "Schedule",
    targetId: updated.id,
  });
  return updated;
}

export async function listSchedules(workspaceId: string) {
  const schedules = await prisma.schedule.findMany({
    where: { workspaceId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      brand: { select: { name: true } },
      questionSet: { select: { name: true } },
      runs: { orderBy: { createdAt: "desc" }, take: 5, include: { task: { select: { id: true, name: true, status: true } } } },
    },
  });
  const [credential, runningCount] = await Promise.all([
    prisma.searchProviderCredential.findUnique({ where: { workspaceId } }),
    prisma.searchTask.count({ where: { status: "RUNNING" } }),
  ]);
  const guard = evaluateRealModeGuard(credential);
  return {
    schedules: schedules.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      frequency: s.frequency,
      timezone: s.timezone,
      hour: s.hour,
      minute: s.minute,
      weekday: s.weekday,
      executionMode: s.executionMode,
      confirmedCost: s.confirmedCost,
      brandName: s.brand?.name ?? null,
      questionSetName: s.questionSet.name,
      questionSetVersionId: s.questionSetVersionId,
      nextRunAt: s.nextRunAt?.toISOString() ?? null,
      lastRunAt: s.lastRunAt?.toISOString() ?? null,
      lastRunStatus: s.lastRunStatus,
      failureCount: s.failureCount,
      timingDescription: describeTiming({
        frequency: s.frequency as ScheduleFrequencyValue,
        hour: s.hour,
        minute: s.minute,
        weekday: s.weekday,
        timezone: s.timezone,
      }),
      runs: s.runs.map((r) => ({
        id: r.id,
        plannedAt: r.plannedAt.toISOString(),
        status: r.status,
        error: r.error,
        task: r.task ? { id: r.task.id, name: r.task.name, status: r.task.status } : null,
        createdAt: r.createdAt.toISOString(),
      })),
    })),
    providerReady: guard.ok,
    providerReason: guard.ok ? null : guard.reason,
    runningTasks: runningCount,
    maxConcurrent: env.scheduleMaxConcurrent,
    maxQuestions: env.scheduleMaxQuestions,
  };
}

interface TriggerResult {
  runId: string;
  taskId: string | null;
  status: "CREATED" | "SKIPPED" | "FAILED";
  message?: string;
}

async function triggerSchedule(
  schedule: Schedule,
  plannedAt: Date,
  userId: string | null,
  options: { advanceNextRun: boolean }
): Promise<TriggerResult> {
  // 幂等：同一排期同一计划时间只允许一个执行记录
  let run;
  try {
    run = await prisma.scheduleRun.create({
      data: {
        workspaceId: schedule.workspaceId,
        scheduleId: schedule.id,
        plannedAt,
        status: "PENDING",
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { runId: "", taskId: null, status: "SKIPPED", message: "该计划时间已存在执行记录（幂等跳过）" };
    }
    throw error;
  }

  if (options.advanceNextRun) {
    try {
      const next = nextRunAfter(plannedAt, {
        frequency: schedule.frequency as ScheduleFrequencyValue,
        hour: schedule.hour,
        minute: schedule.minute,
        weekday: schedule.weekday,
        timezone: schedule.timezone,
      });
      await prisma.schedule.update({ where: { id: schedule.id }, data: { nextRunAt: next } });
    } catch (error) {
      await prisma.schedule.update({ where: { id: schedule.id }, data: { nextRunAt: null, status: "PAUSED" } });
      await prisma.scheduleRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          error: `无法计算下次执行时间：${error instanceof Error ? error.message : "未知错误"}`,
          errorCategory: "INVALID_SCHEDULE",
          finishedAt: new Date(),
        },
      });
      return { runId: run.id, taskId: null, status: "FAILED", message: "无法计算下次执行时间" };
    }
  }

  // 并发限制（单实例语义）：全局运行中任务数 + 同一排期不重叠
  const [runningTotal, runningForSchedule] = await Promise.all([
    prisma.searchTask.count({ where: { status: "RUNNING" } }),
    prisma.searchTask.count({ where: { scheduleId: schedule.id, status: "RUNNING" } }),
  ]);
  if (runningTotal >= env.scheduleMaxConcurrent || runningForSchedule > 0) {
    const message =
      runningForSchedule > 0
        ? "同一排期已有正在执行的任务，跳过本次执行"
        : `当前运行中的采集任务已达上限（${env.scheduleMaxConcurrent}），跳过本次执行`;
    await prisma.scheduleRun.update({
      where: { id: run.id },
      data: { status: "SKIPPED", error: message, errorCategory: "CONCURRENCY_LIMIT", finishedAt: new Date() },
    });
    await prisma.schedule.update({
      where: { id: schedule.id },
      data: { lastRunAt: new Date(), lastRunStatus: "SKIPPED" },
    });
    return { runId: run.id, taskId: null, status: "SKIPPED", message };
  }

  if (schedule.executionMode === "REAL") {
    const credential = await prisma.searchProviderCredential.findUnique({ where: { workspaceId: schedule.workspaceId } });
    const guard = evaluateRealModeGuard(credential);
    if (!guard.ok) {
      await prisma.scheduleRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          error: guard.reason ?? "数据源未就绪",
          errorCategory: guard.code ?? "PROVIDER_NOT_READY",
          finishedAt: new Date(),
        },
      });
      await prisma.schedule.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: "FAILED",
          failureCount: { increment: 1 },
        },
      });
      return { runId: run.id, taskId: null, status: "FAILED", message: guard.reason };
    }
  }

  const params = (schedule.params ?? {}) as Record<string, unknown>;
  let task;
  try {
    task = await createSearchTask(schedule.workspaceId, schedule.createdById, {
      name: `${schedule.name} · ${plannedAt.toISOString().slice(0, 10)}`,
      description: `定时采集执行（计划时间 ${plannedAt.toISOString()}）`,
      brandId: schedule.brandId ?? undefined,
      questionSetId: schedule.questionSetId,
      questionSetVersionId: schedule.questionSetVersionId ?? undefined,
      provider: schedule.executionMode === "REAL" ? "YUANBAO" : "MOCK",
      executionMode: schedule.executionMode,
      maxResults: typeof params.maxResults === "number" ? params.maxResults : undefined,
      mode: typeof params.mode === "number" ? (params.mode as 0 | 1 | 2) : undefined,
      industry: typeof params.industry === "string" ? (params.industry as never) : undefined,
      freshness: typeof params.freshness === "string" ? params.freshness : undefined,
      site: typeof params.site === "string" ? params.site : undefined,
      deeplinks: typeof params.deeplinks === "boolean" ? params.deeplinks : undefined,
      source: "SCHEDULE",
      scheduleId: schedule.id,
      scheduleRunId: run.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建定时任务失败";
    const code = searchExecutionErrorCode(error);
    await prisma.scheduleRun.update({
      where: { id: run.id },
      data: { status: "FAILED", error: message, errorCategory: code, finishedAt: new Date() },
    });
    await prisma.schedule.update({
      where: { id: schedule.id },
      data: { lastRunAt: new Date(), lastRunStatus: "FAILED", failureCount: { increment: 1 } },
    });
    return { runId: run.id, taskId: null, status: "FAILED", message };
  }

  await prisma.scheduleRun.update({
    where: { id: run.id },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  // 后台执行，不阻塞调度 tick；完成后回写执行状态
  const executorId = userId ?? schedule.createdById;
  void startSearchTask(task.id, schedule.workspaceId, executorId)
    .then(async (finalTask) => {
      const finalStatus = finalTask?.status ?? "FAILED";
      const failed = finalStatus === "COMPLETED" ? 0 : 1;
      await prisma.scheduleRun.update({
        where: { id: run.id },
        data: {
          status: finalStatus === "CANCELLED" ? "FAILED" : finalStatus === "FAILED" ? "FAILED" : "COMPLETED",
          error:
            finalStatus === "PARTIAL_FAILED"
              ? `部分问题执行失败（成功 ${finalTask?.successItems ?? 0} / 失败 ${finalTask?.failedItems ?? 0}）`
              : finalStatus === "FAILED"
                ? finalTask?.failureReason ?? "任务执行失败"
                : null,
          errorCategory: finalStatus === "FAILED" ? "TASK_FAILED" : null,
          finishedAt: new Date(),
        },
      });
      await prisma.schedule.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: finalStatus === "FAILED" || finalStatus === "CANCELLED" ? "FAILED" : "COMPLETED",
          ...(failed > 0 ? { failureCount: { increment: 1 } } : { failureCount: 0 }),
        },
      });
    })
    .catch(async (error) => {
      await prisma.scheduleRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          error: error instanceof Error ? error.message : "任务执行异常",
          errorCategory: "EXECUTOR_ERROR",
          finishedAt: new Date(),
        },
      });
      await prisma.schedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: new Date(), lastRunStatus: "FAILED", failureCount: { increment: 1 } },
      });
    });

  return { runId: run.id, taskId: task.id, status: "CREATED" };
}

/** 手动立即执行一次排期（用户主动触发，仍受并发与成本确认约束）。 */
export async function runScheduleNow(workspaceId: string, userId: string, scheduleId: string) {
  const schedule = await prisma.schedule.findFirst({ where: { id: scheduleId, workspaceId } });
  if (!schedule) throw new ScheduleError("SCHEDULE_NOT_FOUND", "排期不存在或不属于当前工作空间");
  if (schedule.status === "CANCELLED") throw new ScheduleError("SCHEDULE_CANCELLED", "已取消的排期不能执行");
  if (schedule.executionMode === "REAL" && !schedule.confirmedCost) {
    throw new ScheduleError("COST_NOT_CONFIRMED", "该排期未确认调用成本，不能执行");
  }
  const result = await triggerSchedule(schedule, new Date(), userId, { advanceNextRun: false });
  await writeAuditLog({
    workspaceId,
    userId,
    action: "SCHEDULE_RUN_NOW",
    targetType: "Schedule",
    targetId: schedule.id,
    metadata: { ...result },
  });
  if (result.status !== "CREATED") {
    throw new ScheduleError(result.status, result.message ?? "执行未创建");
  }
  return result;
}

/**
 * 运行所有到期排期。供内置调度器与外部 cron tick 调用。
 * 返回真实执行结果，不伪造成功。
 */
export async function runDueSchedules(options: { workspaceId?: string; limit?: number; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const due = await prisma.schedule.findMany({
    where: {
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      status: "ACTIVE",
      OR: [{ executionMode: "MOCK" }, { confirmedCost: true }],
      nextRunAt: { lte: now },
    },
    orderBy: { nextRunAt: "asc" },
    take: options.limit ?? 5,
  });
  const results: Array<{ scheduleId: string; scheduledFor: string; status: string; taskId: string | null; message?: string }> = [];
  for (const schedule of due) {
    const plannedAt = schedule.nextRunAt ?? now;
    try {
      const result = await triggerSchedule(schedule, plannedAt, null, { advanceNextRun: true });
      results.push({
        scheduleId: schedule.id,
        scheduledFor: plannedAt.toISOString(),
        status: result.status,
        taskId: result.taskId,
        message: result.message,
      });
    } catch (error) {
      results.push({
        scheduleId: schedule.id,
        scheduledFor: plannedAt.toISOString(),
        status: "FAILED",
        taskId: null,
        message: error instanceof Error ? error.message : "未知错误",
      });
    }
  }
  return { checkedAt: now.toISOString(), dueCount: due.length, results };
}
