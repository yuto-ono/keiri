import type { InvoicePdfRenderer } from "#lib/application/issue-invoice";
import { DomainValidationError } from "#lib/domain/domain-validation-error";
import { resolveInvoiceAmounts } from "#lib/domain/invoice-calculation";
import type { Invoice, TaxCategory } from "#lib/domain/model";

export interface InvoicePdfRegenerationContext {
  invoice: Invoice | undefined;
  taxCategories: readonly TaxCategory[];
}

export interface InvoicePdfRegenerationGateway {
  loadRegenerationContext(
    invoiceNumber: string,
  ): Promise<InvoicePdfRegenerationContext>;
  replaceIssuedPdf(
    invoice: Invoice,
    contents: Uint8Array,
  ): Promise<{ pdfFilePath: string }>;
}

export async function regenerateInvoicePdf(
  gateway: InvoicePdfRegenerationGateway,
  renderer: InvoicePdfRenderer,
  invoiceNumber: string,
): Promise<{ invoice: Invoice; pdfFilePath: string }> {
  const { invoice, taxCategories } =
    await gateway.loadRegenerationContext(invoiceNumber);
  if (invoice === undefined) {
    throw new DomainValidationError("請求書PDFを再生成できません。", [
      {
        path: ["invoiceNumber"],
        message: `請求書 ${invoiceNumber} が存在しません。`,
      },
    ]);
  }
  if (invoice.status !== "issued" || invoice.pdf.issuedFileName === null) {
    throw new DomainValidationError("請求書PDFを再生成できません。", [
      {
        path: ["status"],
        message: "正式PDFが記録された発行済み請求書を指定してください。",
      },
    ]);
  }

  const { calculation, taxCategory } = resolveInvoiceAmounts(
    invoice,
    taxCategories,
  );
  if (taxCategory === null) {
    throw new DomainValidationError("請求書PDFを再生成できません。", [
      { path: ["lineItems"], message: "請求明細がありません。" },
    ]);
  }
  const contents = await renderer.renderSinglePagePdf({
    invoice,
    taxCategory,
    calculation,
  });
  const { pdfFilePath } = await gateway.replaceIssuedPdf(invoice, contents);
  return { invoice, pdfFilePath };
}
