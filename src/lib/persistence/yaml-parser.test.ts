import { describe, expect, it } from "vitest";
import { z } from "zod";

import { DataValidationError } from "./data-validation-error";
import { parseYaml } from "./yaml-parser";

const simpleSchema = z.strictObject({ value: z.string() });

describe("YAML共通解析", () => {
  it("YAML 1.2 core schemaで1ドキュメントを解析する", () => {
    expect(parseYaml("value: yes\n", "sample.yaml", simpleSchema)).toEqual({
      value: "yes",
    });
  });

  it("CRLFと異なるインデント幅を許可する", () => {
    const schema = z.strictObject({ values: z.array(z.string()) });
    expect(
      parseYaml(
        "values:\r\n    - first\r\n    - second\r\n",
        "sample.yaml",
        schema,
      ),
    ).toEqual({ values: ["first", "second"] });
  });

  it.each([
    {
      name: "開始記号",
      source: "---\nvalue: text\n",
      expected: "ドキュメント開始記号",
    },
    {
      name: "終了記号",
      source: "value: text\n...\n",
      expected: "ドキュメント終了記号",
    },
    {
      name: "アンカーとエイリアス",
      source: "value: &text text\ncopy: *text\n",
      expected: "YAMLのアンカー",
    },
    {
      name: "マージキー",
      source: "value: text\n<<:\n  extra: true\n",
      expected: "YAMLのマージキー",
    },
    {
      name: "標準の明示的型タグ",
      source: "value: !!str text\n",
      expected: "YAMLの明示的な型タグ",
    },
    {
      name: "独自の明示的型タグ",
      source: "value: !custom text\n",
      expected: "YAMLの明示的な型タグ",
    },
  ])("$name を拒否する", ({ source, expected }) => {
    expectIssues(source, expected);
  });

  it("重複キーを位置付きで拒否する", () => {
    try {
      parseYaml("value: first\nvalue: second\n", "sample.yaml", simpleSchema);
      expect.fail("DataValidationError が必要です");
    } catch (error) {
      expect(error).toBeInstanceOf(DataValidationError);
      const issue = (error as DataValidationError).issues[0];
      expect(issue.message).toContain("Map keys must be unique");
      expect(issue.line).toBe(2);
      expect(issue.column).toBe(1);
    }
  });

  it("未知のキーを読み飛ばさず拒否する", () => {
    try {
      parseYaml("value: text\nextra: true\n", "sample.yaml", simpleSchema);
      expect.fail("DataValidationError が必要です");
    } catch (error) {
      expect(error).toBeInstanceOf(DataValidationError);
      expect((error as DataValidationError).issues[0].path).toEqual([]);
      expect((error as DataValidationError).issues[0].message).toContain(
        "Unrecognized key",
      );
    }
  });

  it.each([
    ["有限でない数値", "value: .inf\n", "有限でない数値"],
    ["安全でない整数", "value: 9007199254740993\n", "安全に扱えない整数"],
    ["精度を失う小数", "value: 999999999999.99001\n", "精度が失われる数値"],
  ])("%s をスキーマ検証前に拒否する", (_name, source, expected) => {
    expectIssues(source, expected);
  });
});

function expectIssues(source: string, expected: string): void {
  try {
    parseYaml(source, "sample.yaml", simpleSchema);
    expect.fail("DataValidationError が必要です");
  } catch (error) {
    expect(error).toBeInstanceOf(DataValidationError);
    expect(
      (error as DataValidationError).issues.some((issue) =>
        issue.message.includes(expected),
      ),
    ).toBe(true);
  }
}
