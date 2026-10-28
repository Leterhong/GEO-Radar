import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { CredentialStatus, TaskStatus, MentionStatus, ItemStatus } from "@prisma/client";

/** 数据源连接状态徽章 */
export function CredentialStatusBadge({ status, className }: { status: CredentialStatus; className?: string }) {
  const map: Record<CredentialStatus, { label: string; variant: "success" | "warning" | "destructive" | "muted" | "secondary" }> = {
    NOT_CONFIGURED: { label: "未配置", variant: "muted" },
    PENDING_VERIFICATION: { label: "待验证", variant: "warning" },
    CONNECTED: { label: "已连接", variant: "success" },
    FAILED: { label: "连接失败", variant: "destructive" },
    DISABLED: { label: "已禁用", variant: "secondary" },
  };
  const entry = map[status] ?? { label: status, variant: "muted" as const };
  return <Badge variant={entry.variant} className={className}>{entry.label}</Badge>;
}

const TASK_STATUS_MAP: Record<TaskStatus, { label: string; variant: "success" | "warning" | "destructive" | "muted" | "secondary" | "default" }> = {
  QUEUED: { label: "排队中", variant: "muted" },
  RUNNING: { label: "执行中", variant: "warning" },
  COMPLETED: { label: "已完成", variant: "success" },
  PARTIAL_FAILED: { label: "部分失败", variant: "warning" },
  FAILED: { label: "失败", variant: "destructive" },
  CANCELLED: { label: "已取消", variant: "secondary" },
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const entry = TASK_STATUS_MAP[status] ?? { label: status, variant: "muted" as const };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}

const ITEM_STATUS_MAP: Record<ItemStatus, { label: string; variant: "success" | "warning" | "destructive" | "muted" | "secondary" }> = {
  PENDING: { label: "待执行", variant: "muted" },
  RUNNING: { label: "执行中", variant: "warning" },
  SUCCESS: { label: "成功", variant: "success" },
  FAILED: { label: "失败", variant: "destructive" },
  CANCELLED: { label: "已取消", variant: "secondary" },
};

export function ItemStatusBadge({ status }: { status: ItemStatus }) {
  const entry = ITEM_STATUS_MAP[status] ?? { label: status, variant: "muted" as const };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}

const MENTION_MAP: Record<MentionStatus, { label: string; variant: "success" | "warning" | "destructive" | "muted" | "secondary" }> = {
  PENDING_REVIEW: { label: "待复核", variant: "warning" },
  CONFIRMED_BRAND: { label: "确认本品牌", variant: "success" },
  CONFIRMED_COMPETITOR: { label: "确认竞品", variant: "secondary" },
  IRRELEVANT: { label: "无关结果", variant: "muted" },
  AMBIGUOUS: { label: "存在歧义", variant: "warning" },
};

export function MentionStatusBadge({ status }: { status: MentionStatus }) {
  const entry = MENTION_MAP[status] ?? { label: status, variant: "muted" as const };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}

export function MockBadge({ isMock }: { isMock: boolean }) {
  return isMock ? (
    <Badge variant="warning" className={cn("border-warning/25")}>
      模拟数据
    </Badge>
  ) : (
    <Badge variant="secondary">真实数据</Badge>
  );
}
