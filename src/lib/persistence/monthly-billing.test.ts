import { describe, expect, it } from "vitest";

import {
  MonthlyBillingParseError,
  parseMonthlyBilling,
} from "./monthly-billing";

const filePath = "monthly-billing/2026/10.md";

describe("月次請求Markdownの解析", () => {
  it.each(["pending", "completed"])(
    "有効な進捗 %s と自由記述の本文を読み取る",
    (status) => {
      const body =
        "\n# 請求メモ\n\n<script>自由記述</script>\n---\nstatus: 本文のため解析しない\n\n";
      expect(
        parseMonthlyBilling(`---\nstatus: ${status}\n---\n${body}`, filePath),
      ).toEqual({ status, body });
    },
  );

  it("BOMとCRLFを受け付け、本文の改行を変えない", () => {
    expect(
      parseMonthlyBilling(
        "\uFEFF---\r\nstatus: completed\r\n---\r\n本文\r\n\r\n",
        filePath,
      ),
    ).toEqual({ status: "completed", body: "本文\r\n\r\n" });
  });

  it.each([
    "",
    "status: completed\n本文",
    "\n---\nstatus: completed\n---\n本文",
    "---\nstatus: completed\n本文",
  ])("境界が分からない場合は全文を保持する (%j)", (source) => {
    expect(() => parseMonthlyBilling(source, filePath)).toThrow(
      MonthlyBillingParseError,
    );
    try {
      parseMonthlyBilling(source, filePath);
    } catch (error) {
      expect(error).toMatchObject({
        filePath,
        body: source,
        issues: [expect.objectContaining({ line: 1, column: 1 })],
      });
    }
  });

  it.each([
    "",
    "status: 未完了",
    "status: true",
    "status: null",
    "status: [pending]",
    "status: completed\nrevision: 1",
    "status: completed\nyear: 2026",
    "status: pending\nstatus: completed",
    "status: &progress completed",
    "status: *progress",
    "status: !!str completed",
    "status: !custom completed",
    "status: completed\n<<: {}",
    "status: completed\n...",
  ])("不正なFront Matterを未完了へ読み替えない (%j)", (header) => {
    try {
      parseMonthlyBilling(`---\n${header}\n---\n本文\n`, filePath);
      expect.fail("解析が成功してはいけません。");
    } catch (error) {
      expect(error).toBeInstanceOf(MonthlyBillingParseError);
      expect(error).toMatchObject({
        filePath,
        body: "本文\n",
        issues: expect.any(Array),
      });
      expect((error as MonthlyBillingParseError).issues.length).toBeGreaterThan(
        0,
      );
    }
  });

  it("構文エラーの位置をMarkdown全体の行番号で返す", () => {
    try {
      parseMonthlyBilling(
        "---\nstatus: pending\nstatus: completed\n---\n本文",
        filePath,
      );
      expect.fail("重複キーは拒否します。");
    } catch (error) {
      expect(error).toMatchObject({
        filePath,
        body: "本文",
        issues: [expect.objectContaining({ line: 3, column: 1 })],
      });
    }
  });
});
