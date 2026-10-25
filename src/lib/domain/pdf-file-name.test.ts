import { describe, expect, it } from "vitest";

import { DomainValidationError } from "./domain-validation-error";
import {
  buildPdfFileName,
  isValidIssuedPdfFileName,
  validatePdfFileNamePattern,
} from "./pdf-file-name";

const values = {
  businessPartnerCode: "ACME",
  addressee: "株式会社サンプル",
  honorific: "御中",
  issueDate: "2026-10-05",
  sequence: 3,
};

describe("PDFファイル名", () => {
  it("既定の命名規則から請求書番号と同じ名前を作る", () => {
    expect(
      buildPdfFileName(
        "{businessPartnerCode}-{issueDate:YYYYMM}-{sequence}",
        null,
        values,
      ),
    ).toBe("ACME-202610-03.pdf");
  });

  it("宛名と日付書式を展開する", () => {
    expect(
      buildPdfFileName(
        "{addresseeWithHonorific}_{issueDate:YYYY-MM-DD}",
        null,
        values,
      ),
    ).toBe("株式会社サンプル御中_2026-10-05.pdf");
  });

  it("個別指定を命名規則より優先し、空白やバックスラッシュを維持する", () => {
    expect(buildPdfFileName("{unknown}", "請求書 \\ 控え", values)).toBe(
      "請求書 \\ 控え.pdf",
    );
  });

  it.each(["", ".", "..", "dir/file", "line\nbreak", "nul\0value"])(
    "不正なベース名 %j を拒否する",
    (override) => {
      expect(() => buildPdfFileName("unused", override, values)).toThrow(
        DomainValidationError,
      );
    },
  );

  it.each(["{unknown}", "{issueDate:YYMM}", "unclosed{sequence"])(
    "不正な命名規則 %s を検出する",
    (pattern) => {
      expect(validatePdfFileNamePattern(pattern)).not.toEqual([]);
    },
  );

  it("発行済みファイル名は安全なベース名と小文字.pdfを要求する", () => {
    expect(isValidIssuedPdfFileName("請求書.pdf")).toBe(true);
    expect(isValidIssuedPdfFileName("請求書.PDF")).toBe(false);
    expect(isValidIssuedPdfFileName("../請求書.pdf")).toBe(false);
  });

  it("不正文字が宛名に由来することを示す", () => {
    try {
      buildPdfFileName("{addresseeWithHonorific}", null, {
        ...values,
        addressee: "株式会社/サンプル",
      });
      expect.fail("DomainValidationError が必要です");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainValidationError);
      expect((error as DomainValidationError).issues[0].message).toContain(
        "由来: 請求書が保持する宛名と敬称",
      );
    }
  });
});
