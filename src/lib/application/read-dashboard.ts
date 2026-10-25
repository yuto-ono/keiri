import {
  currentAndPreviousMonthForDate,
  isBusinessDateAfter,
} from "#lib/domain/business-date";
import { resolveInvoiceAmounts } from "#lib/domain/invoice-calculation";
import type { DomainValidationIssue } from "#lib/domain/domain-validation-error";
import type { MonthlyBillingStatus } from "#lib/domain/model";
import type { KeiriReadData } from "#lib/application/read-keiri-data";

export interface MonthlyBillingReadIssue extends DomainValidationIssue {
  line?: number;
  column?: number;
}

export type MonthlyBillingReadResult = { filePath: string } & (
  | { kind: "missing" }
  | { kind: "recorded"; status: MonthlyBillingStatus; body: string }
  | { kind: "error"; body: string; issues: readonly MonthlyBillingReadIssue[] }
);

export interface DashboardReadGateway {
  loadData(): Promise<KeiriReadData>;
  readMonthlyBilling(month: string): Promise<MonthlyBillingReadResult>;
}

export async function getDashboard(
  gateway: DashboardReadGateway,
  today: string,
) {
  const months = currentAndPreviousMonthForDate(today);
  const data = await gateway.loadData();
  const monthlyBilling = await Promise.all(
    months.map(async (month) => ({
      month,
      ...(await gateway.readMonthlyBilling(month)),
    })),
  );
  const overdueInvoices = data.invoices
    .filter(
      (invoice) =>
        invoice.status === "issued" &&
        invoice.paymentCompletedDate === null &&
        isBusinessDateAfter(today, invoice.paymentDueDate),
    )
    .toSorted((left, right) =>
      left.paymentDueDate === right.paymentDueDate
        ? 0
        : isBusinessDateAfter(left.paymentDueDate, right.paymentDueDate)
          ? 1
          : -1,
    )
    .map((invoice) => ({
      paymentDueDate: invoice.paymentDueDate,
      invoiceNumber: invoice.invoiceNumber,
      addresseeWithHonorific: `${invoice.businessPartner.snapshot.addressee}${invoice.businessPartner.snapshot.honorific}`,
      totalAmount: resolveInvoiceAmounts(invoice, data.taxCategories)
        .calculation.totalAmount,
    }));
  return { today, monthlyBilling, overdueInvoices };
}
