import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import type { ReactNode } from "react";
import { Info } from "lucide-react";

/** KPI 指标卡：数值 + 样本量 + 口径说明；无数据时显示“暂无数据”，不伪造数字。 */
export function KpiCard({
  title,
  value,
  sub,
  methodology,
  footer,
  accent = "primary",
  className,
}: {
  title: string;
  value: string;
  sub?: string;
  methodology?: string;
  footer?: ReactNode;
  accent?: "primary" | "mint" | "violet" | "cyan" | "sand";
  className?: string;
}) {
  const accentBar: Record<string, string> = {
    primary: "bg-brand-blue",
    mint: "bg-brand-mint",
    violet: "bg-brand-violet",
    cyan: "bg-brand-cyan",
    sand: "bg-brand-sand",
  };
  return (
    <Card className={cn("group relative overflow-hidden transition-colors hover:border-border-strong", className)}>
      <span className={cn("absolute inset-x-0 top-0 h-[2px] opacity-70", accentBar[accent] ?? accentBar.primary)} />
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-medium text-tertiary">{title}</p>
          {methodology ? (
            <span
              title={methodology}
              aria-label={`口径说明：${methodology}`}
              className="inline-flex cursor-help items-center gap-1 rounded-full border border-border bg-card px-1.5 py-0.5 text-[10px] leading-4 text-quaternary transition-colors group-hover:text-tertiary"
            >
              <Info className="h-2.5 w-2.5" />
              口径
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-[26px] font-semibold leading-none tracking-tight text-[color:var(--text-primary)]">
          {value}
        </p>
        {sub ? <p className="mt-2 text-[12px] leading-5 text-quaternary">{sub}</p> : null}
        {footer ? <div className="mt-3">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-[color:var(--text-primary)]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
  tone = "neutral",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  tone?: "neutral" | "gradient";
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center",
        tone === "gradient" ? "bg-gradient-a" : "bg-surface-subtle/60",
        className
      )}
    >
      <p className="text-[15px] font-medium text-[color:var(--text-primary)]">{title}</p>
      {description ? (
        <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** 分区标题：用于页面内的小节组织 */
export function SectionTitle({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-start justify-between gap-3", className)}>
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight text-[color:var(--text-primary)]">{title}</h2>
        {description ? <p className="mt-1 text-[12px] text-quaternary">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** 提示条：info / success / warning / danger 四种轻量色 */
export function InlineAlert({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: string;
  children: React.ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    info: "border-border-strong bg-info-soft text-primary-strong",
    success: "border-success/25 bg-success-soft text-success",
    warning: "border-warning/25 bg-warning-soft text-warning",
    danger: "border-destructive/25 bg-destructive/8 text-destructive",
  };
  return (
    <div className={cn("rounded-lg border px-3.5 py-3 text-[12px] leading-relaxed", tones[tone], className)}>
      {title ? <p className="mb-0.5 font-medium">{title}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0">{children}</span>
        {action}
      </div>
    </div>
  );
}
