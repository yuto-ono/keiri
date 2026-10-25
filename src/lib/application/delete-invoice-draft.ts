import { DomainValidationError } from "#lib/domain/domain-validation-error";
import { validateInvoiceForDeletion } from "#lib/domain/invoice-validation";
import type { Invoice } from "#lib/domain/model";

export interface InvoiceDeletionGateway {
  loadInvoice(invoiceNumber: string): Promise<Invoice | undefined>;
  deleteInvoice(invoice: Invoice): Promise<{ filePath: string }>;
}

export interface DeleteInvoiceDraftInput {
  invoiceNumber: string;
  expectedRevision: number;
}

export interface DeleteInvoiceDraftResult {
  invoiceNumber: string;
  filePath: string;
}

export async function deleteInvoiceDraft(
  gateway: InvoiceDeletionGateway,
  input: DeleteInvoiceDraftInput,
): Promise<DeleteInvoiceDraftResult> {
  const invoice = await gateway.loadInvoice(input.invoiceNumber);
  if (invoice === undefined) {
    throw new DomainValidationError("請求書を削除できません。", [
      {
        path: ["invoiceNumber"],
        message: `請求書 ${input.invoiceNumber} が存在しません。`,
      },
    ]);
  }

  const issues = validateInvoiceForDeletion(invoice);
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 1
  ) {
    issues.push({
      path: ["revision"],
      message: "期待リビジョンは1以上の安全な整数にしてください。",
    });
  } else if (input.expectedRevision !== invoice.revision) {
    issues.push({
      path: ["revision"],
      message: `期待リビジョン${input.expectedRevision}は現在のリビジョン${invoice.revision}と一致しません。`,
    });
  }
  if (issues.length > 0) {
    throw new DomainValidationError("請求書を削除できません。", issues);
  }

  const deleted = await gateway.deleteInvoice(invoice);
  return { invoiceNumber: invoice.invoiceNumber, filePath: deleted.filePath };
}
