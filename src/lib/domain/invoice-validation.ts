import { isBusinessDate, isBusinessDateAfter } from "#lib/domain/business-date";
import type { DomainValidationIssue } from "#lib/domain/domain-validation-error";
import type { Invoice } from "#lib/domain/model";

export function validateInvoiceForIssue(
  invoice: Invoice,
  today: string,
): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];

  if (invoice.status !== "draft") {
    issues.push({
      path: ["status"],
      message: "発行できるのは下書きの請求書だけです。",
    });
  }

  if (!isBusinessDate(today)) {
    throw new RangeError(`現在日が不正です: ${today}`);
  }

  if (!isBusinessDate(invoice.issueDate)) {
    issues.push({ path: ["issueDate"], message: "発行日が不正です。" });
  } else if (isBusinessDateAfter(invoice.issueDate, today)) {
    issues.push({
      path: ["issueDate"],
      message: "未来の発行日を持つ請求書は、その日まで発行できません。",
    });
  }

  if (!isBusinessDate(invoice.paymentDueDate)) {
    issues.push({
      path: ["paymentDueDate"],
      message: "支払期限が不正です。",
    });
  } else if (
    isBusinessDate(invoice.issueDate) &&
    isBusinessDateAfter(invoice.issueDate, invoice.paymentDueDate)
  ) {
    issues.push({
      path: ["paymentDueDate"],
      message: "支払期限は発行日以降にしてください。",
    });
  }

  if (invoice.lineItems.length === 0 || invoice.lineItems.length > 10) {
    issues.push({
      path: ["lineItems"],
      message: "発行する請求書の明細は1件以上10件以下にしてください。",
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

  if (invoice.issuer.snapshot.bankAccounts.length === 0) {
    issues.push({
      path: ["issuer", "snapshot", "bankAccounts"],
      message: "発行する請求書には振込先が1件以上必要です。",
    });
  }

  return issues;
}
