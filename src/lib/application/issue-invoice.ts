import {
  DomainValidationError,
  type DomainValidationIssue,
} from "#lib/domain/domain-validation-error";
import {
  calculateInvoiceAmounts,
  type InvoiceCalculation,
} from "#lib/domain/invoice-calculation";
import { validateInvoiceForIssue } from "#lib/domain/invoice-validation";
import type {
  BusinessPartner,
  Invoice,
  TaxCategory,
  TaxableTaxCategory,
} from "#lib/domain/model";
import { buildPdfFileName } from "#lib/domain/pdf-file-name";

export interface InvoiceIssueContext {
  invoice: Invoice | undefined;
  businessPartner: BusinessPartner | undefined;
  taxCategories: readonly TaxCategory[];
}

export interface InvoicePdfRenderInput {
  invoice: Invoice;
  taxCategory: TaxableTaxCategory;
  calculation: InvoiceCalculation;
}

export interface InvoicePdfRenderer {
  renderSinglePagePdf(input: InvoicePdfRenderInput): Promise<Uint8Array>;
}

export interface InvoiceIssueGateway {
  loadIssueContext(invoiceNumber: string): Promise<InvoiceIssueContext>;
  commitIssuedInvoice(
    currentInvoice: Invoice,
    issuedInvoice: Invoice,
    pdf: { fileName: string; contents: Uint8Array },
  ): Promise<{ invoiceFilePath: string; pdfFilePath: string }>;
}

export interface IssueInvoiceInput {
  invoiceNumber: string;
  expectedRevision: number;
  today: string;
}

export interface IssueInvoiceResult {
  invoice: Invoice;
  invoiceFilePath: string;
  pdfFilePath: string;
}

export async function issueInvoice(
  gateway: InvoiceIssueGateway,
  renderer: InvoicePdfRenderer,
  input: IssueInvoiceInput,
): Promise<IssueInvoiceResult> {
  const context = await gateway.loadIssueContext(input.invoiceNumber);
  const currentInvoice = context.invoice;
  if (currentInvoice === undefined) {
    throw new DomainValidationError("請求書を発行できません。", [
      {
        path: ["invoiceNumber"],
        message: `請求書 ${input.invoiceNumber} が存在しません。`,
      },
    ]);
  }

  const issues = validateInvoiceForIssue(currentInvoice, input.today);
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

  const businessPartner = context.businessPartner;
  if (businessPartner === undefined) {
    issues.push({
      path: ["businessPartner", "code"],
      message: `取引先 ${currentInvoice.businessPartner.code} が存在しません。`,
    });
  }

  const taxCategory = findTaxCategoryForIssue(
    currentInvoice,
    context.taxCategories,
    issues,
  );
  const sequence = extractInvoiceSequence(currentInvoice, issues);
  if (
    issues.length > 0 ||
    businessPartner === undefined ||
    taxCategory === undefined ||
    sequence === undefined
  ) {
    throw new DomainValidationError("請求書を発行できません。", issues);
  }

  const calculation = calculateInvoiceAmounts({
    lineItems: currentInvoice.lineItems,
    unitPricesIncludeTax: currentInvoice.unitPricesIncludeTax,
    rounding: currentInvoice.rounding,
    taxCategory,
  });
  const pdfFileName = buildPdfFileName(
    businessPartner.pdfFileNamePattern,
    currentInvoice.pdf.fileNameOverride,
    {
      businessPartnerCode: currentInvoice.businessPartner.code,
      addressee: currentInvoice.businessPartner.snapshot.addressee,
      honorific: currentInvoice.businessPartner.snapshot.honorific,
      issueDate: currentInvoice.issueDate,
      sequence,
    },
  );
  const issuedInvoice: Invoice = {
    ...currentInvoice,
    revision: currentInvoice.revision + 1,
    status: "issued",
    pdf: {
      ...currentInvoice.pdf,
      issuedFileName: pdfFileName,
    },
  };
  const pdfContents = await renderer.renderSinglePagePdf({
    invoice: issuedInvoice,
    taxCategory,
    calculation,
  });
  const saved = await gateway.commitIssuedInvoice(
    currentInvoice,
    issuedInvoice,
    { fileName: pdfFileName, contents: pdfContents },
  );
  return {
    invoice: issuedInvoice,
    invoiceFilePath: saved.invoiceFilePath,
    pdfFilePath: saved.pdfFilePath,
  };
}

function findTaxCategoryForIssue(
  invoice: Invoice,
  taxCategories: readonly TaxCategory[],
  issues: DomainValidationIssue[],
): TaxableTaxCategory | undefined {
  const taxCategoryId = invoice.lineItems[0]?.taxCategoryId;
  if (taxCategoryId === undefined) {
    return undefined;
  }
  const taxCategory = taxCategories.find(
    (candidate) => candidate.id === taxCategoryId,
  );
  if (
    taxCategory === undefined ||
    taxCategory.treatment !== "taxable" ||
    !taxCategory.isStandardRate
  ) {
    issues.push({
      path: ["lineItems", 0, "taxCategoryId"],
      message: `税区分 ${taxCategoryId} は初期版で発行できる標準税率の課税区分ではありません。`,
    });
    return undefined;
  }
  return taxCategory;
}

function extractInvoiceSequence(
  invoice: Invoice,
  issues: DomainValidationIssue[],
): number | undefined {
  const match = /-(0[1-9]|[1-9]\d)$/.exec(invoice.invoiceNumber);
  if (match === null) {
    issues.push({
      path: ["invoiceNumber"],
      message: "請求書番号から2桁の連番を取得できません。",
    });
    return undefined;
  }
  return Number(match[1]);
}
