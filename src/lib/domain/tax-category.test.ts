import { describe, expect, it } from "vitest";

import { DomainValidationError } from "./domain-validation-error";
import type { TaxCategory } from "./model";
import { selectCurrentStandardTaxCategory } from "./tax-category";

const standardTaxCategory: TaxCategory = {
  id: "standard-10",
  name: "標準10%",
  treatment: "taxable",
  deprecated: false,
  isStandardRate: true,
  ratePercent: 10,
};

describe("新規請求書の税区分選択", () => {
  it("課税・標準税率・未廃止の定義を選ぶ", () => {
    const categories: TaxCategory[] = [
      {
        id: "reduced-8",
        name: "軽減8%",
        treatment: "taxable",
        deprecated: false,
        isStandardRate: false,
        ratePercent: 8,
      },
      { ...standardTaxCategory, deprecated: true, id: "old-standard-10" },
      standardTaxCategory,
    ];

    expect(selectCurrentStandardTaxCategory(categories)).toBe(
      standardTaxCategory,
    );
  });

  it.each([
    { categories: [] },
    {
      categories: [
        standardTaxCategory,
        { ...standardTaxCategory, id: "other" },
      ],
    },
  ])("候補が1件でなければ拒否する", ({ categories }) => {
    expect(() => selectCurrentStandardTaxCategory(categories)).toThrow(
      DomainValidationError,
    );
  });
});
