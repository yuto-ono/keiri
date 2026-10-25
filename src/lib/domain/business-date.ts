import { TZDateMini } from "@date-fns/tz";
import { format, isValid, parseISO, subMonths } from "date-fns";

export const BUSINESS_TIME_ZONE = "Asia/Tokyo";

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isBusinessDate(value: string): boolean {
  if (!BUSINESS_DATE_PATTERN.test(value)) {
    return false;
  }

  const parsed = parseISO(value);
  return isValid(parsed) && format(parsed, "yyyy-MM-dd") === value;
}

export function todayInTokyo(now: Date = new Date()): string {
  return format(new TZDateMini(now, BUSINESS_TIME_ZONE), "yyyy-MM-dd");
}

export function currentAndPreviousMonthInTokyo(
  now: Date = new Date(),
): readonly [currentMonth: string, previousMonth: string] {
  return currentAndPreviousMonthForDate(todayInTokyo(now));
}

export function currentAndPreviousMonthForDate(
  today: string,
): readonly [currentMonth: string, previousMonth: string] {
  assertBusinessDate(today);
  const current = parseISO(today);
  return [format(current, "yyyy-MM"), format(subMonths(current, 1), "yyyy-MM")];
}

export function formatBusinessDate(value: string): string {
  assertBusinessDate(value);
  return format(parseISO(value), "yyyy年MM月dd日");
}

export function formatBusinessMonth(value: string): string {
  const firstDay = `${value}-01`;
  assertBusinessDate(firstDay);
  return format(parseISO(firstDay), "yyyy年M月");
}

export function isBusinessDateAfter(left: string, right: string): boolean {
  assertBusinessDate(left);
  assertBusinessDate(right);
  return left > right;
}

export function isSameBusinessMonth(left: string, right: string): boolean {
  assertBusinessDate(left);
  assertBusinessDate(right);
  return left.slice(0, 7) === right.slice(0, 7);
}

function assertBusinessDate(value: string): void {
  if (!isBusinessDate(value)) {
    throw new RangeError(`業務日付が不正です: ${value}`);
  }
}
