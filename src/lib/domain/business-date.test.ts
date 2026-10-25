import { describe, expect, it } from "vitest";

import {
  currentAndPreviousMonthInTokyo,
  formatBusinessDate,
  isBusinessDate,
  isBusinessDateAfter,
  isSameBusinessMonth,
  todayInTokyo,
} from "./business-date";

describe("業務日付", () => {
  it.each([
    ["2024-02-29", true],
    ["2023-02-29", false],
    ["2026-2-01", false],
    ["2026-02-1", false],
    ["2026-02-01T00:00:00+09:00", false],
  ])("%s の妥当性を判定する", (value, expected) => {
    expect(isBusinessDate(value)).toBe(expected);
  });

  it("現在日時を東京の日付へ変換する", () => {
    const justBeforeTokyoMidnight = new Date("2026-10-24T14:59:59.999Z");
    const atTokyoMidnight = new Date("2026-10-24T15:00:00.000Z");

    expect(todayInTokyo(justBeforeTokyoMidnight)).toBe("2026-10-24");
    expect(todayInTokyo(atTokyoMidnight)).toBe("2026-10-25");
  });

  it("東京基準の今月と先月を年またぎで返す", () => {
    expect(
      currentAndPreviousMonthInTokyo(new Date("2025-12-31T15:00:00.000Z")),
    ).toEqual(["2026-01", "2025-12"]);
  });

  it("表示、比較、同月判定を行う", () => {
    expect(formatBusinessDate("2026-10-05")).toBe("2026年10月05日");
    expect(isBusinessDateAfter("2026-10-06", "2026-10-05")).toBe(true);
    expect(isSameBusinessMonth("2026-10-01", "2026-10-31")).toBe(true);
    expect(isSameBusinessMonth("2026-10-31", "2026-11-01")).toBe(false);
  });

  it("不正な日付の整形を拒否する", () => {
    expect(() => formatBusinessDate("2026-02-29")).toThrow(RangeError);
  });
});
