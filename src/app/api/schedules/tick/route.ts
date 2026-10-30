import { timingSafeEqual } from "crypto";
import { env } from "@/lib/env";
import { apiFail, withWriteAuth } from "@/server/api/helpers";
import { runDueSchedules } from "@/server/services/schedule-service";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * 调度 tick（外部 cron 入口）。
 * - 配置 CRON_SECRET 时：必须提供 x-cron-secret，处理所有工作空间到期排期；
 * - 未配置时：仅允许已登录用户触发当前工作空间的到期排期（开发/手动）。
 *
 * 该接口会真实创建并执行搜索任务（仅对已确认成本的真实排期），不是 dry-run。
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (env.cronSecret) {
    if (!secret || !safeEqual(secret, env.cronSecret)) {
      return apiFail(401, "UNAUTHORIZED", "x-cron-secret 缺失或不匹配。");
    }
    const result = await runDueSchedules({ limit: 10 });
    return NextResponse.json({ ok: true, data: result });
  }

  return withWriteAuth(async ({ workspaceId }) => {
    const result = await runDueSchedules({ workspaceId, limit: 10 });
    return { ...result, mode: "WORKSPACE_ONLY", note: "未配置 CRON_SECRET，仅处理当前工作空间。" };
  });
}
