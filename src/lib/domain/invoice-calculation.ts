import BigNumber from "bignumber.js";

import { DomainValidationError } from "#lib/domain/domain-validation-error";
import type {
  InvoiceLineItem,
  Invoice,
  InvoiceRounding,
  RoundingMethod,
  TaxCategory,
  TaxableTaxCategory,
} from "#lib/domain/model";

const MAX_QUANTITY = new BigNumber("999999999999.99");
const MAX_UNIT_PRICE = 999_999_999_999;

export interface InvoiceCalculationInput {
  lineItems: readonly InvoiceLineItem[];
  unitPricesIncludeTax: boolean;
  rounding: InvoiceRounding;
  taxCategory: TaxableTaxCategory;
}

export interface InvoiceCalculation {
  lineAmounts: string[];
  taxableAmount: string;
  taxAmount: string;
  totalAmount: string;
}

export function resolveInvoiceAmounts(
  invoice: Pick<Invoice, "lineItems" | "unitPricesIncludeTax" | "rounding">,
  taxCategories: readonly TaxCategory[],
): { calculation: InvoiceCalculation; taxCategory: TaxableTaxCategory | null } {
  if (invoice.lineItems.length === 0) {
    return {
      calculation: {
        lineAmounts: [],
        taxableAmount: "0",
        taxAmount: "0",
        totalAmount: "0",
      },
      taxCategory: null,
    };
  }
  const id = invoice.lineItems[0].taxCategoryId;
  const taxCategory = taxCategories.find((category) => category.id === id);
  if (
    taxCategory === undefined ||
    taxCategory.treatment !== "taxable" ||
    !taxCategory.isStandardRate
  ) {
    throw new DomainValidationError("請求金額を計算できません。", [
      {
        path: ["lineItems", 0, "taxCategoryId"],
        message: `税区分 ${id} は標準税率の課税区分ではありません。`,
      },
    ]);
  }
  return {
    taxCategory,
    calculation: calculateInvoiceAmounts({
      lineItems: invoice.lineItems,
      unitPricesIncludeTax: invoice.unitPricesIncludeTax,
      rounding: invoice.rounding,
      taxCategory,
    }),
  };
}

export function calculateInvoiceAmounts(
  input: InvoiceCalculationInput,
): InvoiceCalculation {
  const issues = validateCalculationInput(input);
  if (issues.length > 0) {
    throw new DomainValidationError("請求金額を計算できません。", issues);
  }

  const lineAmounts = input.lineItems.map((lineItem) =>
    roundAmount(
      new BigNumber(lineItem.quantity).multipliedBy(lineItem.unitPrice),
      input.rounding.lineAmount,
    ),
  );
  const lineAmountTotal = BigNumber.sum(...lineAmounts);
  const ratePercent = new BigNumber(input.taxCategory.ratePercent);

  if (input.unitPricesIncludeTax) {
    const taxAmount = roundAmount(
      lineAmountTotal
        .multipliedBy(ratePercent)
        .dividedBy(new BigNumber(100).plus(ratePercent)),
      input.rounding.taxAmount,
    );

    return {
      lineAmounts: lineAmounts.map(toIntegerString),
      taxableAmount: toIntegerString(lineAmountTotal.minus(taxAmount)),
      taxAmount: toIntegerString(taxAmount),
      totalAmount: toIntegerString(lineAmountTotal),
    };
  }

  const taxAmount = roundAmount(
    lineAmountTotal.multipliedBy(ratePercent).dividedBy(100),
    input.rounding.taxAmount,
  );

  return {
    lineAmounts: lineAmounts.map(toIntegerString),
    taxableAmount: toIntegerString(lineAmountTotal),
    taxAmount: toIntegerString(taxAmount),
    totalAmount: toIntegerString(lineAmountTotal.plus(taxAmount)),
  };
}

function validateCalculationInput(
  input: InvoiceCalculationInput,
): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];

  if (
    !input.taxCategory.isStandardRate ||
    !Number.isSafeInteger(input.taxCategory.ratePercent) ||
    input.taxCategory.ratePercent < 1 ||
    input.taxCategory.ratePercent > 100
  ) {
    issues.push({
      path: ["taxCategory"],
      message: "1〜100%の標準税率に該当する課税区分が必要です。",
    });
  }

  input.lineItems.forEach((lineItem, index) => {
    const quantity = new BigNumber(lineItem.quantity);
    const quantityDecimalPlaces = quantity.decimalPlaces();
    if (
      !Number.isFinite(lineItem.quantity) ||
      quantity.isLessThanOrEqualTo(0) ||
      quantity.isGreaterThan(MAX_QUANTITY) ||
      quantityDecimalPlaces === null ||
      quantityDecimalPlaces > 2
    ) {
      issues.push({
        path: ["lineItems", index, "quantity"],
        message:
          "数量は0より大きく999999999999.99以下、小数点以下2桁までにしてください。",
      });
    }

    if (
      !Number.isSafeInteger(lineItem.unitPrice) ||
      lineItem.unitPrice <= 0 ||
      lineItem.unitPrice > MAX_UNIT_PRICE
    ) {
      issues.push({
        path: ["lineItems", index, "unitPrice"],
        message: "単価は1〜999999999999の安全な整数にしてください。",
      });
    }

    if (lineItem.taxCategoryId !== input.taxCategory.id) {
      issues.push({
        path: ["lineItems", index, "taxCategoryId"],
        message: "1枚の請求書ではすべての明細に同じ税区分を指定してください。",
      });
    }
  });

  return issues;
}

function roundAmount(amount: BigNumber, method: RoundingMethod): BigNumber {
  const roundingMode = {
    floor: BigNumber.ROUND_FLOOR,
    halfUp: BigNumber.ROUND_HALF_UP,
    ceil: BigNumber.ROUND_CEIL,
  }[method];

  return amount.integerValue(roundingMode);
}

function toIntegerString(amount: BigNumber): string {
  return amount.toFixed(0);
}
