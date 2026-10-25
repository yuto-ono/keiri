import { DomainValidationError } from "#lib/domain/domain-validation-error";
import { validateInvoiceForRevertToDraft } from "#lib/domain/invoice-validation";
import type { Invoice } from "#lib/domain/model";

export interface InvoiceRevertToDraftGateway {
  loadInvoice(invoiceNumber: string): Promise<Invoice | undefined>;
  commitRevertedInvoice(
    currentInvoice: Invoice,
    draftInvoice: Invoice,
  ): Promise<{ invoiceFilePath: string; pdfFilePath: string }>;
}

export interface RevertInvoiceToDraftInput {
  invoiceNumber: string;
  expectedRevision: number;
}

export interface RevertInvoiceToDraftResult {
  invoice: Invoice;
  invoiceFilePath: string;
  pdfFilePath: string;
}

export async function revertInvoiceToDraft(
  gateway: InvoiceRevertToDraftGateway,
  input: RevertInvoiceToDraftInput,
): Promise<RevertInvoiceToDraftResult> {
  const currentInvoice = await gateway.loadInvoice(input.invoiceNumber);
  if (currentInvoice === undefined) {
    throw new DomainValidationError("請求書を下書きへ戻せません。", [
      {
        path: ["invoiceNumber"],
        message: `請求書 ${input.invoiceNumber} が存在しません。`,
      },
    ]);
  }

  const issues = validateInvoiceForRevertToDraft(currentInvoice);
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 1
  ) {
    issues.push({
      path: ["revision"],
      message: "期待リビジョンは1以上の安全な整数にしてください。",
    });
  } else if (input.expectedRevision !== currentInvoice.revision) {
    issues.push({
      path: ["revision"],
      message: `期待リビジョン${input.expectedRevision}は現在のリビジョン${currentInvoice.revision}と一致しません。`,
    });
  }
  if (issues.length > 0) {
    throw new DomainValidationError("請求書を下書きへ戻せません。", issues);
  }

  const draftInvoice: Invoice = {
    ...currentInvoice,
    revision: currentInvoice.revision + 1,
    status: "draft",
    pdf: { ...currentInvoice.pdf, issuedFileName: null },
  };
  const saved = await gateway.commitRevertedInvoice(
    currentInvoice,
    draftInvoice,
  );
  return { invoice: draftInvoice, ...saved };
}
