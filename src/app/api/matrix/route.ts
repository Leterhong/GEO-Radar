import { prisma } from "@/server/db/client";
import { withAuth, apiFail } from "@/server/api/helpers";
import {
  buildRoundDataset,
  findLatestRoundTaskId,
  listRoundTasks,
  pageTypeLabel,
  matrixCellStateLabel,
} from "@/server/services/matrix-service";
import type { PageTypeValue } from "@/lib/page-classification";

export const dynamic = "force-dynamic";

/**
 * 品牌问题矩阵数据：全部由服务端计算。
 * - ?list=1：返回可选轮次
 * - ?taskId=：指定轮次
 * - ?brandId=：未指定 taskId 时取该品牌最近一次有效真实任务
 */
export async function GET(request: Request) {
  return withAuth(async ({ workspaceId }) => {
    const url = new URL(request.url);
    const taskId = url.searchParams.get("taskId");
    const brandId = url.searchParams.get("brandId");
    const includeMock = url.searchParams.get("includeMock") === "true";
    const listOnly = url.searchParams.get("list") === "true";
    const labels = {
      pageTypes: Object.fromEntries(
        (
          [
            "OFFICIAL_HOMEPAGE",
            "PRODUCT_PAGE",
            "DOCS_PAGE",
            "BLOG_NEWS",
            "THIRD_PARTY_MEDIA",
            "ECOMMERCE_PAGE",
            "COMMUNITY_FORUM",
            "OTHER",
            "UNKNOWN",
          ] as PageTypeValue[]
        ).map((type) => [type, pageTypeLabel(type)])
      ),
      cellStates: Object.fromEntries(
        (["FOUND", "NOT_FOUND", "TASK_FAILED", "EMPTY", "NOT_COLLECTED", "NEEDS_REVIEW"] as const).map((state) => [
          state,
          matrixCellStateLabel(state),
        ])
      ),
    };

    const rounds = await listRoundTasks(workspaceId, { brandId: brandId ?? undefined, includeMock, limit: 100 });
    if (listOnly) {
      return { rounds, labels };
    }

    let selectedTaskId = taskId ?? null;
    if (selectedTaskId) {
      const task = await prisma.searchTask.findFirst({
        where: { id: selectedTaskId, workspaceId },
        select: { id: true },
      });
      if (!task) return apiFail(404, "TASK_NOT_FOUND", "任务不存在或不属于当前工作空间。");
    } else if (brandId) {
      selectedTaskId = await findLatestRoundTaskId(workspaceId, brandId, { includeMock });
    }

    if (!selectedTaskId) {
      return {
        dataset: null,
        rounds,
        message: brandId
          ? "该品牌还没有可用的真实采集轮次（成功且返回结果）。请先执行搜索任务，或选择其他轮次。"
          : "请先选择品牌与采集轮次。",
        labels,
      };
    }

    const dataset = await buildRoundDataset(workspaceId, selectedTaskId);
    return { dataset, rounds, labels };
  });
}
