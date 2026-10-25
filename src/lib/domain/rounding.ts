import type { DomainValidationIssue } from "#lib/domain/domain-validation-error";
import type { InvoiceRounding } from "#lib/domain/model";

export function validateRoundingSettings(
  rounding: InvoiceRounding,
): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];
  for (const field of ["lineAmount", "taxAmount"] as const) {
    if (!["floor", "halfUp", "ceil"].includes(rounding[field])) {
      issues.push({
        path: ["rounding", field],
        message: "端数処理はfloor、halfUp、ceilから選択してください。",
      });
    }
  }
  return issues;
}
