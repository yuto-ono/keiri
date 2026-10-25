import { DomainValidationError } from "./domain-validation-error";
import type { TaxableTaxCategory, TaxCategory } from "./model";

export function selectCurrentStandardTaxCategory(
  taxCategories: readonly TaxCategory[],
): TaxableTaxCategory {
  const candidates = taxCategories.filter(
    (taxCategory): taxCategory is TaxableTaxCategory =>
      taxCategory.treatment === "taxable" &&
      taxCategory.isStandardRate &&
      !taxCategory.deprecated,
  );

  if (candidates.length !== 1) {
    throw new DomainValidationError(
      "新規請求書へ適用する標準税率の税区分を一意に決定できません。",
      [
        {
          path: ["taxCategories"],
          message: `課税・標準税率・未廃止の税区分は1件必要ですが、${candidates.length}件あります。`,
        },
      ],
    );
  }

  return candidates[0];
}
