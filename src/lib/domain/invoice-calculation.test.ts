import { describe, expect, it } from "vitest";

import { DomainValidationError } from "./domain-validation-error";
import {
  calculateInvoiceAmounts,
  type InvoiceCalculationInput,
} from "./invoice-calculation";

function createInput(
  overrides: Partial<InvoiceCalculationInput> = {},
): InvoiceCalculationInput {
  return {
    lineItems: [
      {
        name: "システム開発業務",
        quantity: 10.5,
        unit: "時間",
        unitPrice: 10_001,
        taxCategoryId: "standard-10",
      },
    ],
    unitPricesIncludeTax: false,
    rounding: { lineAmount: "floor", taxAmount: "floor" },
    taxCategory: {
      id: "standard-10",
      name: "標準10%",
      treatment: "taxable",
      deprecated: false,
      isStandardRate: true,
      ratePercent: 10,
    },
    ...overrides,
  };
}

describe("請求金額計算", () => {
  it("税抜単価では明細を丸めてから税率ごとに税額を1回丸める", () => {
    expect(calculateInvoiceAmounts(createInput())).toEqual({
      lineAmounts: ["105010"],
      taxableAmount: "105010",
      taxAmount: "10501",
      totalAmount: "115511",
    });
  });

  it.each([
    ["floor", "105010"],
    ["halfUp", "105011"],
    ["ceil", "105011"],
  ] as const)("明細金額へ %s を適用する", (lineAmount, expected) => {
    const result = calculateInvoiceAmounts(
      createInput({
        rounding: { lineAmount, taxAmount: "floor" },
      }),
    );

    expect(result.lineAmounts).toEqual([expected]);
  });

  it.each([
    ["floor", "1000"],
    ["halfUp", "1001"],
    ["ceil", "1001"],
  ] as const)("税額へ %s を適用する", (taxAmount, expected) => {
    const result = calculateInvoiceAmounts(
      createInput({
        lineItems: [
          {
            name: "業務",
            quantity: 1,
            unit: "式",
            unitPrice: 10_005,
            taxCategoryId: "standard-10",
          },
        ],
        rounding: { lineAmount: "floor", taxAmount },
      }),
    );

    expect(result.taxAmount).toBe(expected);
  });

  it("税込単価では税込合計から税額と税抜額を求める", () => {
    expect(
      calculateInvoiceAmounts(
        createInput({
          lineItems: [
            {
              name: "業務",
              quantity: 1,
              unit: "式",
              unitPrice: 1_100,
              taxCategoryId: "standard-10",
            },
          ],
          unitPricesIncludeTax: true,
        }),
      ),
    ).toEqual({
      lineAmounts: ["1100"],
      taxableAmount: "1000",
      taxAmount: "100",
      totalAmount: "1100",
    });
  });

  it("JavaScriptの安全な整数を超える合計も文字列で正確に返す", () => {
    const result = calculateInvoiceAmounts(
      createInput({
        lineItems: [
          {
            name: "業務",
            quantity: 999_999_999_999.99,
            unit: "式",
            unitPrice: 999_999_999_999,
            taxCategoryId: "standard-10",
          },
        ],
      }),
    );

    expect(result.lineAmounts).toEqual(["999999999998990000000000"]);
    expect(result.totalAmount).toBe("1099999999998889000000000");
  });

  it("明細が空なら各金額を0として返す", () => {
    expect(calculateInvoiceAmounts(createInput({ lineItems: [] }))).toEqual({
      lineAmounts: [],
      taxableAmount: "0",
      taxAmount: "0",
      totalAmount: "0",
    });
  });

  it("計算対象の複数の不正をまとめて返す", () => {
    try {
      calculateInvoiceAmounts(
        createInput({
          lineItems: [
            {
              name: "業務",
              quantity: 0,
              unit: "式",
              unitPrice: 0,
              taxCategoryId: "other",
            },
          ],
        }),
      );
      expect.fail("DomainValidationError が必要です");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainValidationError);
      expect((error as DomainValidationError).issues).toHaveLength(3);
    }
  });
});
