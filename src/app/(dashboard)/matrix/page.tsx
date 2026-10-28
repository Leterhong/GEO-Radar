import { prisma } from "@/server/db/client";
import { requireWorkspace } from "@/server/auth/guard";
import { PageHeader } from "@/components/shared/kpi-card";
import { MatrixClient } from "@/components/matrix/matrix-client";

export const dynamic = "force-dynamic";

export default async function MatrixPage({
  searchParams,
}: {
  searchParams: { brandId?: string; includeMock?: string };
}) {
  const { workspaceId } = await requireWorkspace();
  const brands = await prisma.brand.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });
  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        title="品牌问题矩阵"
        description="横轴为搜索问题，纵轴为品牌与竞品。所有指标由服务端按统一口径计算；失败与空结果不会伪装成「未发现」。点击任意单元格可下钻到页面级证据。"
      />
      <MatrixClient brands={brands} initialBrandId={searchParams.brandId} initialIncludeMock={searchParams.includeMock === "true"} />
    </div>
  );
}
