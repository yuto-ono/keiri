import type { InvoiceDraftFormContent } from "#lib/application/create-invoice-draft";
import { createInvoiceForPartner } from "#lib/testing/business-partners";

export function createInvoiceDraftFormContent(
  overrides: Partial<InvoiceDraftFormContent> = {},
): InvoiceDraftFormContent {
  return {
    transactionDate: "2026-10-25",
    honorific: "御中",
    unitPricesIncludeTax: false,
    bankAccountIds: ["primary"],
    lineItems: createInvoiceForPartner().lineItems,
    notes: null,
    pdfFileNameOverride: null,
    ...overrides,
  };
}
