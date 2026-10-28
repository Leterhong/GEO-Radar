import Link from "next/link";
import { Check, ArrowRight, Plug, ListChecks, PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SetupState {
  searchConfigured: boolean;
  questionCount: number;
  taskCount: number;
}

/**
 * 上手引导：用真实完成状态展示三步（配置数据源 → 建立问题集 → 执行搜索）。
 * 只反映数据库中的真实状态，不伪造进度。
 */
export function SetupGuide({ state, className }: { state: SetupState; className?: string }) {
  const steps = [
    {
      key: "datasource",
      title: "配置搜索数据源",
      description: "在设置中填入元宝搜索的服务 API Key，并完成一次真实连接测试。",
      href: "/settings",
      cta: "前往配置",
      icon: Plug,
      done: state.searchConfigured,
    },
    {
      key: "questions",
      title: "建立问题集",
      description: "把你关心的搜索问题按主题组织，支持 CSV 批量导入。",
      href: "/questions",
      cta: "管理问题",
      icon: ListChecks,
      done: state.questionCount > 0,
      detail: state.questionCount > 0 ? `已有 ${state.questionCount} 个问题` : undefined,
    },
    {
      key: "run",
      title: "执行第一次真实搜索",
      description: "在搜索实验室按问题集创建任务，确认请求数量后执行。",
      href: "/search-lab",
      cta: "发起搜索",
      icon: PlayCircle,
      done: state.taskCount > 0,
      detail: state.taskCount > 0 ? `已有 ${state.taskCount} 个任务` : undefined,
    },
  ];
  const completed = steps.filter((s) => s.done).length;

  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-gradient-a", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-5 py-3.5">
        <div>
          <p className="text-[14px] font-semibold text-[color:var(--text-primary)]">开始使用 GEO Radar</p>
          <p className="mt-0.5 text-[12px] text-tertiary">
            按顺序完成三步即可获得第一批可追溯的搜索证据（已完成 {completed}/3）。
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {steps.map((step) => (
            <span
              key={step.key}
              className={cn(
                "h-1.5 w-8 rounded-full transition-colors",
                step.done ? "bg-brand-blue" : "bg-border"
              )}
              aria-hidden
            />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 divide-y divide-border/70 md:grid-cols-3 md:divide-x md:divide-y-0">
        {steps.map((step, index) => (
          <div key={step.key} className="flex flex-col gap-2 px-5 py-4">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium",
                  step.done ? "bg-brand-blue text-white" : "border border-border bg-card text-tertiary"
                )}
              >
                {step.done ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <p className="text-[13px] font-medium text-[color:var(--text-primary)]">{step.title}</p>
            </div>
            <p className="text-[12px] leading-relaxed text-tertiary">{step.description}</p>
            <div className="mt-auto flex items-center justify-between gap-2 pt-1">
              {step.detail ? <span className="text-[11px] text-quaternary">{step.detail}</span> : <span />}
              <Link
                href={step.href}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-primary transition-colors hover:text-primary-strong"
              >
                {step.done ? "查看" : step.cta}
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
