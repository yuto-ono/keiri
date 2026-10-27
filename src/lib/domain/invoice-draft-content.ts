import { isBusinessDate } from "#lib/domain/business-date";
import {
  DomainValidationError,
  type DomainValidationIssue,
} from "#lib/domain/domain-validation-error";
import { resolveInvoiceAmounts } from "#lib/domain/invoice-calculation";
import type { Invoice, TaxCategory } from "#lib/domain/model";
import { validatePdfBaseName } from "#lib/domain/pdf-file-name";

export function validateInvoiceDraftContent(
  invoice: Pick<
    Invoice,
    | "invoiceDate"
    | "paymentDueDate"
    | "lineItems"
    | "unitPricesIncludeTax"
    | "rounding"
  > & { pdf: Pick<Invoice["pdf"], "fileNameOverride"> },
  taxCategories: readonly TaxCategory[],
): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];
  for (const [key, label] of [
    ["invoiceDate", "請求日"],
    ["paymentDueDate", "支払期限"],
  ] as const) {
    if (!isBusinessDate(invoice[key])) {
      issues.push({ path: [key], message: `${label}が不正です。` });
    }
  }
  if (
    invoice.pdf.fileNameOverride !== null &&
    validatePdfBaseName(invoice.pdf.fileNameOverride).length > 0
  ) {
    issues.push({
      path: ["pdf", "fileNameOverride"],
      message: "PDFの個別ファイル名が不正です。",
    });
  }
  invoice.lineItems.forEach((lineItem, index) => {
    if (lineItem.name.length === 0) {
      issues.push({
        path: ["lineItems", index, "name"],
        message: "品目名は必須です。",
      });
    }
    if (lineItem.unit.length === 0) {
      issues.push({
        path: ["lineItems", index, "unit"],
        message: "単位は必須です。",
      });
    }
  });
  try {
    resolveInvoiceAmounts(invoice, taxCategories);
  } catch (error) {
    if (error instanceof DomainValidationError) {
      issues.push(...error.issues);
    } else {
      throw error;
    }
  }
  return issues;
}
