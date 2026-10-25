import { describe, expect, it, vi } from "vitest";

import { DomainValidationError } from "#lib/domain/domain-validation-error";
import type { BusinessPartner, Invoice, TaxCategory } from "#lib/domain/model";

import {
  issueInvoice,
  type InvoiceIssueContext,
  type InvoiceIssueGateway,
  type InvoicePdfRenderer,
} from "./issue-invoice";

const businessPartner: BusinessPartner = {
  revision: 1,
  code: "ACME",
  addressee: "現在の宛名はファイル名に使わない",
  honorific: "様",
  requiresMonthlyInvoice: true,
  billingInstructions: null,
  unitPricesIncludeTax: false,
  issuerDisplay: {
    phone: false,
    email: false,
    bankAccountIds: ["primary"],
  },
  pdfFileNamePattern: "{addresseeWithHonorific}-{issueDate:YYYYMM}-{sequence}",
};

const taxCategories: TaxCategory[] = [
  {
    id: "standard-10",
    name: "標準10%",
    treatment: "taxable",
    deprecated: false,
    isStandardRate: true,
    ratePercent: 10,
  },
];

function createInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    revision: 3,
    status: "draft",
    invoiceNumber: "ACME-202610-07",
    businessPartner: {
      code: "ACME",
      snapshot: { addressee: "固定済み宛名", honorific: "御中" },
    },
    issuer: {
      id: "issuer",
      snapshot: {
        name: "発行者",
        registrationNumber: "T1234567890123",
        phone: { visible: false },
        email: { visible: false },
        bankAccounts: [
          {
            id: "primary",
            bankName: "第一銀行",
            branchName: "本店",
            branchCode: "001",
            accountType: "ordinary",
            accountNumber: "1234567",
            accountHolderName: "ハッコウシャ",
          },
        ],
      },
    },
    issueDate: "2026-10-20",
    transactionDate: "2026-10-20",
    paymentDueDate: "2026-11-30",
    paymentCompletedDate: null,
    unitPricesIncludeTax: false,
    lineItems: [
      {
        name: "開発業務",
        quantity: 2,
        unit: "時間",
        unitPrice: 10_000,
        taxCategoryId: "standard-10",
      },
    ],
    notes: null,
    rounding: { lineAmount: "floor", taxAmount: "floor" },
    pdf: { fileNameOverride: null, issuedFileName: null },
    ...overrides,
  };
}

function createHarness(
  context: InvoiceIssueContext = {
    invoice: createInvoice(),
    businessPartner,
    taxCategories,
  },
) {
  const commitIssuedInvoice = vi.fn<InvoiceIssueGateway["commitIssuedInvoice"]>(
    async () => ({
      invoiceFilePath: "sales/invoices/2026/ACME-202610-07.yaml",
      pdfFilePath:
        "documents/2026/sales/invoices/ACME/固定済み宛名御中-202610-07.pdf",
    }),
  );
  const gateway: InvoiceIssueGateway = {
    async loadIssueContext() {
      return context;
    },
    commitIssuedInvoice,
  };
  const renderSinglePagePdf = vi.fn<InvoicePdfRenderer["renderSinglePagePdf"]>(
    async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  );
  const renderer: InvoicePdfRenderer = { renderSinglePagePdf };
  return { gateway, renderer, commitIssuedInvoice, renderSinglePagePdf };
}

describe("請求書の発行", () => {
  it("検証済みPDFと発行済み請求書を一体で保存する", async () => {
    const harness = createHarness();
    const result = await issueInvoice(harness.gateway, harness.renderer, {
      invoiceNumber: "ACME-202610-07",
      expectedRevision: 3,
      today: "2026-10-25",
    });

    expect(result.invoice).toMatchObject({
      revision: 4,
      status: "issued",
      pdf: {
        fileNameOverride: null,
        issuedFileName: "固定済み宛名御中-202610-07.pdf",
      },
    });
    expect(harness.renderSinglePagePdf).toHaveBeenCalledWith({
      invoice: result.invoice,
      taxCategory: taxCategories[0],
      calculation: {
        lineAmounts: ["20000"],
        taxableAmount: "20000",
        taxAmount: "2000",
        totalAmount: "22000",
      },
    });
    expect(harness.commitIssuedInvoice).toHaveBeenCalledWith(
      createInvoice(),
      result.invoice,
      {
        fileName: "固定済み宛名御中-202610-07.pdf",
        contents: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      },
    );
    expect(result).toMatchObject({
      invoiceFilePath: "sales/invoices/2026/ACME-202610-07.yaml",
      pdfFilePath:
        "documents/2026/sales/invoices/ACME/固定済み宛名御中-202610-07.pdf",
    });
  });

  it("PDFの個別ファイル名を命名規則より優先する", async () => {
    const invoice = createInvoice({
      pdf: { fileNameOverride: "個別の請求書", issuedFileName: null },
    });
    const harness = createHarness({
      invoice,
      businessPartner,
      taxCategories,
    });

    const result = await issueInvoice(harness.gateway, harness.renderer, {
      invoiceNumber: invoice.invoiceNumber,
      expectedRevision: invoice.revision,
      today: "2026-10-25",
    });

    expect(result.invoice.pdf.issuedFileName).toBe("個別の請求書.pdf");
  });

  it("発行条件と期待リビジョンの問題をまとめて返し副作用を起こさない", async () => {
    const invoice = createInvoice({
      issueDate: "2026-10-26",
      paymentDueDate: "2026-10-19",
      lineItems: [],
      issuer: {
        ...createInvoice().issuer,
        snapshot: {
          ...createInvoice().issuer.snapshot,
          bankAccounts: [],
        },
      },
    });
    const harness = createHarness({
      invoice,
      businessPartner,
      taxCategories,
    });

    const error = await issueInvoice(harness.gateway, harness.renderer, {
      invoiceNumber: invoice.invoiceNumber,
      expectedRevision: 2,
      today: "2026-10-25",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DomainValidationError);
    expect((error as DomainValidationError).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["issueDate"] }),
        expect.objectContaining({ path: ["paymentDueDate"] }),
        expect.objectContaining({ path: ["lineItems"] }),
        expect.objectContaining({
          path: ["issuer", "snapshot", "bankAccounts"],
        }),
        expect.objectContaining({ path: ["revision"] }),
      ]),
    );
    expect(harness.renderSinglePagePdf).not.toHaveBeenCalled();
    expect(harness.commitIssuedInvoice).not.toHaveBeenCalled();
  });

  it("発行済み請求書は再度発行しない", async () => {
    const invoice = createInvoice({
      status: "issued",
      pdf: { fileNameOverride: null, issuedFileName: "issued.pdf" },
    });
    const harness = createHarness({
      invoice,
      businessPartner,
      taxCategories,
    });

    await expect(
      issueInvoice(harness.gateway, harness.renderer, {
        invoiceNumber: invoice.invoiceNumber,
        expectedRevision: invoice.revision,
        today: "2026-10-25",
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);
    expect(harness.renderSinglePagePdf).not.toHaveBeenCalled();
    expect(harness.commitIssuedInvoice).not.toHaveBeenCalled();
  });

  it("請求書が存在しなければPDFを生成しない", async () => {
    const harness = createHarness({
      invoice: undefined,
      businessPartner: undefined,
      taxCategories,
    });

    await expect(
      issueInvoice(harness.gateway, harness.renderer, {
        invoiceNumber: "MISSING-202610-01",
        expectedRevision: 1,
        today: "2026-10-25",
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);
    expect(harness.renderSinglePagePdf).not.toHaveBeenCalled();
    expect(harness.commitIssuedInvoice).not.toHaveBeenCalled();
  });

  it("PDF生成に失敗した場合は状態を保存しない", async () => {
    const harness = createHarness();
    harness.renderSinglePagePdf.mockRejectedValueOnce(
      new Error("フォントを読み込めません。"),
    );

    await expect(
      issueInvoice(harness.gateway, harness.renderer, {
        invoiceNumber: "ACME-202610-07",
        expectedRevision: 3,
        today: "2026-10-25",
      }),
    ).rejects.toThrow("フォントを読み込めません。");
    expect(harness.commitIssuedInvoice).not.toHaveBeenCalled();
  });
});
