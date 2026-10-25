import {
  DomainValidationError,
  type DomainValidationIssue,
} from "#lib/domain/domain-validation-error";
import {
  validateInvoiceForPaymentManagement,
  validatePaymentCompletedDate,
} from "#lib/domain/invoice-payment";
import type { Invoice } from "#lib/domain/model";

export interface InvoicePaymentGateway {
  loadInvoice(invoiceNumber: string): Promise<Invoice | undefined>;
  saveInvoicePayment(
    currentInvoice: Invoice,
    updatedInvoice: Invoice,
  ): Promise<{ filePath: string }>;
}

export interface InvoicePaymentInput {
  invoiceNumber: string;
  expectedRevision: number;
}

export interface SetInvoicePaymentCompletedDateInput extends InvoicePaymentInput {
  paymentCompletedDate: string;
  today: string;
}

export interface InvoicePaymentResult {
  invoice: Invoice;
  filePath: string;
}

export async function setInvoicePaymentCompletedDate(
  gateway: InvoicePaymentGateway,
  input: SetInvoicePaymentCompletedDateInput,
): Promise<InvoicePaymentResult> {
  return changeInvoicePaymentCompletedDate(
    gateway,
    input,
    input.paymentCompletedDate,
    validatePaymentCompletedDate(input.paymentCompletedDate, input.today),
  );
}

export async function deleteInvoicePaymentCompletedDate(
  gateway: InvoicePaymentGateway,
  input: InvoicePaymentInput,
): Promise<InvoicePaymentResult> {
  return changeInvoicePaymentCompletedDate(gateway, input, null, []);
}

async function changeInvoicePaymentCompletedDate(
  gateway: InvoicePaymentGateway,
  input: InvoicePaymentInput,
  paymentCompletedDate: string | null,
  dateIssues: readonly DomainValidationIssue[],
): Promise<InvoicePaymentResult> {
  const currentInvoice = await gateway.loadInvoice(input.invoiceNumber);
  if (currentInvoice === undefined) {
    throw new DomainValidationError("入金完了日を変更できません。", [
      {
        path: ["invoiceNumber"],
        message: `請求書 ${input.invoiceNumber} が存在しません。`,
      },
    ]);
  }

  const issues = [
    ...validateInvoiceForPaymentManagement(currentInvoice),
    ...dateIssues,
  ];
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
    throw new DomainValidationError("入金完了日を変更できません。", issues);
  }

  const updatedInvoice: Invoice = {
    ...currentInvoice,
    revision: currentInvoice.revision + 1,
    paymentCompletedDate,
  };
  const saved = await gateway.saveInvoicePayment(
    currentInvoice,
    updatedInvoice,
  );
  return { invoice: updatedInvoice, filePath: saved.filePath };
}
