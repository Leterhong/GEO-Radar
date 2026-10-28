import { requireWorkspace } from "@/server/auth/guard";
import { ExperimentsClient } from "@/components/experiments/experiments-client";
import { PageHeader } from "@/components/shared/kpi-card";

export const dynamic = "force-dynamic";

export default async function ExperimentsPage() {
  await requireWorkspace();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="实验对比"
        description="选择一个基线任务和优化后的复测任务进行对比。两次任务的样本差异会被明确提示。"
      />
      <ExperimentsClient />
    </div>
  );
}
