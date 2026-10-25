import { describe, expect, it } from "vitest";

import { formatIssueLocation, formatYen } from "./format";

describe("画面の表示用整形", () => {
  it.each([
    ["0", "0円"],
    ["11000", "11,000円"],
    ["9007199254740993", "9,007,199,254,740,993円"],
  ])("金額 %s を精度を失わず表示する", (amount, label) => {
    expect(formatYen(amount)).toBe(label);
  });

  it("ファイル・項目・位置を表示し、指定がない要素を補わない", () => {
    expect(
      formatIssueLocation({
        filePath: "issuers/issuer.yaml",
        path: ["bankAccounts", 0, "id"],
        line: 3,
        column: 2,
        message: "不正",
      }),
    ).toBe("issuers/issuer.yaml / bankAccounts.0.id / 3行 2列");
    expect(
      formatIssueLocation(
        { path: ["status"], message: "不正" },
        "monthly-billing/2026/10.md",
      ),
    ).toBe("monthly-billing/2026/10.md / status");
    expect(formatIssueLocation({ path: [], message: "不正" })).toBe("");
  });
});
