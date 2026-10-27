import {
  buildInvoiceDraft,
  type CreateInvoiceDraftResult,
  type InvoiceCreationGateway,
  type InvoiceDraftFormContent,
} from "#lib/application/create-invoice-draft";
import { DomainValidationError } from "#lib/domain/domain-validation-error";

export interface DuplicateInvoiceDraftInput {
  sourceInvoiceNumber: string;
  paymentDueDate: string;
  invoiceDate?: string;
  businessPartnerCode?: string;
  today: string;
  content?: InvoiceDraftFormContent;
}

export async function duplicateInvoiceDraft(
  gateway: InvoiceCreationGateway,
  input: DuplicateInvoiceDraftInput,
): Promise<CreateInvoiceDraftResult> {
  const context = await gateway.loadCreationContext();
  const source = context.invoices.find(
    (invoice) => invoice.invoiceNumber === input.sourceInvoiceNumber,
  );
  if (source === undefined) {
    throw new DomainValidationError("請求書を複製できません。", [
      {
        path: ["sourceInvoiceNumber"],
        message: `複製元の請求書 ${input.sourceInvoiceNumber} が存在しません。`,
      },
    ]);
  }

  const invoice = buildInvoiceDraft(
    context,
    {
      businessPartnerCode:
        input.businessPartnerCode ?? source.businessPartner.code,
      paymentDueDate: input.paymentDueDate,
      invoiceDate: input.invoiceDate,
      today: input.today,
      content: input.content,
    },
    {
      lineItems: source.lineItems,
      notes: source.notes,
    },
  );
  const saved = await gateway.saveNewInvoice(invoice);
  return { invoice, filePath: saved.filePath };
}
