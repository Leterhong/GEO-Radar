/**
 * 定时采集时间计算（IANA 时区，支持 DST）。
 * 不依赖第三方库：通过 Intl.DateTimeFormat 将时区墙面时间换算成 UTC，
 * 并对 DST 跳变做一次校正；如果目标墙面时间不存在则跳过该日。
 */

export type ScheduleFrequencyValue = "DAILY" | "WEEKLY";

export interface ScheduleTiming {
  frequency: ScheduleFrequencyValue;
  hour: number;
  minute: number;
  /** ISO 星期：1=周一 … 7=周日；仅 WEEKLY 必需 */
  weekday?: number | null;
  timezone: string;
}

export class ScheduleTimeError extends Error {
  constructor(message: string) {
    super(message);
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsInZone(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function offsetMsAt(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/** 将某时区的墙面时间转换为 UTC Date；不存在的时间（DST 跳变）返回 null。 */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date | null {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = wallAsUtc - offsetMsAt(new Date(wallAsUtc), timeZone);
  // 再校正一次，处理偏移变化
  candidate = wallAsUtc - offsetMsAt(new Date(candidate), timeZone);
  const check = partsInZone(new Date(candidate), timeZone);
  if (
    check.year !== year ||
    check.month !== month ||
    check.day !== day ||
    check.hour !== hour ||
    check.minute !== minute
  ) {
    return null;
  }
  return new Date(candidate);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** ISO 星期（1=周一…7=周日） */
export function isoWeekday(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const utc = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const day = utc.getUTCDay(); // 0=周日
  return day === 0 ? 7 : day;
}

/** 从 base 之后的第一次执行时间（严格大于 base）。 */
export function nextRunAfter(base: Date, timing: ScheduleTiming): Date {
  if (!isValidTimeZone(timing.timezone)) throw new ScheduleTimeError(`无效的时区：${timing.timezone}`);
  const hour = Math.min(23, Math.max(0, Math.floor(timing.hour)));
  const minute = Math.min(59, Math.max(0, Math.floor(timing.minute)));
  if (timing.frequency === "WEEKLY" && (!timing.weekday || timing.weekday < 1 || timing.weekday > 7)) {
    throw new ScheduleTimeError("每周采集必须指定 1-7 的星期");
  }

  const baseParts = partsInZone(base, timing.timezone);
  for (let dayOffset = 0; dayOffset <= 21; dayOffset += 1) {
    // 以 UTC 日期做日历加法，再按目标时区取墙面日期
    const dateCursor = new Date(Date.UTC(baseParts.year, baseParts.month - 1, baseParts.day + dayOffset));
    const year = dateCursor.getUTCFullYear();
    const month = dateCursor.getUTCMonth() + 1;
    const day = dateCursor.getUTCDate();
    const candidateIsoWeekday = (() => {
      const d = dateCursor.getUTCDay();
      return d === 0 ? 7 : d;
    })();

    if (timing.frequency === "WEEKLY" && candidateIsoWeekday !== timing.weekday) continue;

    const utc = zonedWallTimeToUtc(year, month, day, hour, minute, timing.timezone);
    if (!utc) continue; // DST 跳过的墙面时间：跳到下一候选日
    if (utc.getTime() > base.getTime()) return utc;
  }
  throw new ScheduleTimeError("无法计算下一次执行时间（时区或时间设置异常）");
}

export function describeTiming(timing: ScheduleTiming): string {
  const time = `${String(timing.hour).padStart(2, "0")}:${String(timing.minute).padStart(2, "0")}`;
  if (timing.frequency === "DAILY") return `每天 ${time}（${timing.timezone}）`;
  const names = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  return `每${names[(timing.weekday ?? 1) - 1] ?? `星期${timing.weekday}`} ${time}（${timing.timezone}）`;
}
