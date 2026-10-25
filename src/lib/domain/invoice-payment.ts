import { isBusinessDate, isBusinessDateAfter } from "#lib/domain/business-date";
import type { DomainValidationIssue } from "#lib/domain/domain-validation-error";
import type { Invoice } from "#lib/domain/model";

export function validateInvoiceForPaymentManagement(
  invoice: Invoice,
): DomainValidationIssue[] {
  if (invoice.status !== "issued") {
    return [
      {
        path: ["status"],
        message: "入金完了日を変更できるのは発行済みの請求書だけです。",
      },
    ];
  }
  return [];
}

export function validatePaymentCompletedDate(
  paymentCompletedDate: string,
  today: string,
): DomainValidationIssue[] {
  if (!isBusinessDate(today)) {
    throw new RangeError(`現在日が不正です: ${today}`);
  }
  if (!isBusinessDate(paymentCompletedDate)) {
    return [
      {
        path: ["paymentCompletedDate"],
        message: "入金完了日は有効なYYYY-MM-DD形式の日付にしてください。",
      },
    ];
  }
  if (isBusinessDateAfter(paymentCompletedDate, today)) {
    return [
      {
        path: ["paymentCompletedDate"],
        message: "入金完了日は現在日以前にしてください。",
      },
    ];
  }
  return [];
}
