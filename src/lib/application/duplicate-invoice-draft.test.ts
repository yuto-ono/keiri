import { describe, expect, it } from "vitest";

import type {
  InvoiceCreationContext,
  InvoiceCreationGateway,
} from "./create-invoice-draft";
import { DomainValidationError } from "../domain/domain-validation-error";
import type { Invoice } from "../domain/model";
import { duplicateInvoiceDraft } from "./duplicate-invoice-draft";

function createSourceInvoice(status: Invoice["status"] = "issued"): Invoice {
  return {
    revision: 5,
    status,
    invoiceNumber: "SOURCE-202609-01",
    businessPartner: {
      code: "SOURCE",
      snapshot: { addressee: "複製元株式会社", honorific: "御中" },
    },
    issuer: {
      id: "issuer",
      snapshot: {
        name: "旧発行者名",
        registrationNumber: "T0000000000000",
        phone: { visible: false },
        email: { visible: false },
        bankAccounts: [],
      },
    },
    issueDate: "2026-09-01",
    transactionDate: "2026-09-01",
    paymentDueDate: "2026-09-30",
    paymentCompletedDate: status === "issued" ? "2026-10-15" : null,
    unitPricesIncludeTax: true,
    lineItems: [
      {
        name: "保守業務",
        quantity: 2.5,
        unit: "時間",
        unitPrice: 20_000,
        taxCategoryId: "standard-10",
      },
    ],
    notes: "複製する備考",
    rounding: { lineAmount: "ceil", taxAmount: "halfUp" },
    pdf: {
      fileNameOverride: "複製元の個別名",
      issuedFileName: status === "issued" ? "source.pdf" : null,
    },
  };
}

function createContext(source = createSourceInvoice()): InvoiceCreationContext {
  return {
    businessPartners: [
      {
        revision: 2,
        code: "SOURCE",
        addressee: "現在の複製元株式会社",
        honorific: "様",
        requiresMonthlyInvoice: true,
        billingInstructions: null,
        unitPricesIncludeTax: false,
        issuerDisplay: {
          phone: true,
          email: false,
          bankAccountIds: ["primary"],
        },
        pdfFileNamePattern:
          "{businessPartnerCode}-{issueDate:YYYYMM}-{sequence}",
      },
      {
        revision: 1,
        code: "OTHER",
        addressee: "別の取引先株式会社",
        honorific: "御中",
        requiresMonthlyInvoice: false,
        billingInstructions: null,
        unitPricesIncludeTax: true,
        issuerDisplay: {
          phone: false,
          email: true,
          bankAccountIds: ["secondary"],
        },
        pdfFileNamePattern:
          "{businessPartnerCode}-{issueDate:YYYYMM}-{sequence}",
      },
    ],
    issuers: [
      {
        revision: 3,
        id: "issuer",
        name: "現在の発行者名",
        registrationNumber: "T1111111111111",
        phone: "00-0000-0000",
        email: "issuer@example.com",
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
          {
            id: "secondary",
            bankName: "第二銀行",
            branchName: "本店",
            branchCode: null,
            accountType: "checking",
            accountNumber: "7654321",
            accountHolderName: "ハッコウシャ",
          },
        ],
        defaultBankAccountId: "primary",
      },
    ],
    taxCategories: [
      {
        id: "standard-10",
        name: "標準10%",
        treatment: "taxable",
        deprecated: false,
        isStandardRate: true,
        ratePercent: 10,
      },
    ],
    settings: {
      revision: 2,
      rounding: { lineAmount: "floor", taxAmount: "floor" },
    },
    invoices: [source],
  };
}

function createGateway(context: InvoiceCreationContext) {
  let savedInvoice: Invoice | undefined;
  const gateway: InvoiceCreationGateway = {
    async loadCreationContext() {
      return context;
    },
    async saveNewInvoice(invoice) {
      savedInvoice = invoice;
      return {
        filePath: `sales/invoices/${invoice.transactionDate.slice(0, 4)}/${invoice.invoiceNumber}.yaml`,
      };
    },
  };
  return { gateway, savedInvoice: () => savedInvoice };
}

describe("請求書の複製", () => {
  it("発行済み請求書から独立した下書きを作る", async () => {
    const source = createSourceInvoice();
    const context = createContext(source);
    const harness = createGateway(context);
    const result = await duplicateInvoiceDraft(harness.gateway, {
      sourceInvoiceNumber: source.invoiceNumber,
      paymentDueDate: "2026-11-30",
      today: "2026-10-25",
    });

    expect(result.invoice).toMatchObject({
      revision: 1,
      status: "draft",
      invoiceNumber: "SOURCE-202610-01",
      issueDate: "2026-10-25",
      transactionDate: "2026-10-25",
      paymentDueDate: "2026-11-30",
      paymentCompletedDate: null,
      unitPricesIncludeTax: false,
      lineItems: source.lineItems,
      notes: "複製する備考",
      rounding: { lineAmount: "floor", taxAmount: "floor" },
      pdf: { fileNameOverride: null, issuedFileName: null },
    });
    expect(result.invoice.businessPartner.snapshot).toEqual({
      addressee: "現在の複製元株式会社",
      honorific: "様",
    });
    expect(result.invoice.issuer.snapshot).toMatchObject({
      name: "現在の発行者名",
      registrationNumber: "T1111111111111",
      phone: { visible: true, value: "00-0000-0000" },
      email: { visible: false },
      bankAccounts: [{ id: "primary" }],
    });
    expect(result.invoice.lineItems).not.toBe(source.lineItems);
    expect(source).toEqual(createSourceInvoice());
  });

  it("指定した取引先、発行日、支払期限から新しい値を作る", async () => {
    const source = createSourceInvoice("draft");
    const harness = createGateway(createContext(source));
    const result = await duplicateInvoiceDraft(harness.gateway, {
      sourceInvoiceNumber: source.invoiceNumber,
      businessPartnerCode: "OTHER",
      paymentDueDate: "2027-01-31",
      issueDate: "2026-12-01",
      today: "2026-10-25",
    });

    expect(result.invoice.invoiceNumber).toBe("OTHER-202612-01");
    expect(result.invoice.businessPartner).toMatchObject({
      code: "OTHER",
      snapshot: { addressee: "別の取引先株式会社", honorific: "御中" },
    });
    expect(result.invoice.unitPricesIncludeTax).toBe(true);
    expect(result.invoice.issuer.snapshot).toMatchObject({
      phone: { visible: false },
      email: { visible: true, value: "issuer@example.com" },
      bankAccounts: [{ id: "secondary" }],
    });
  });

  it("複製元がなければ保存しない", async () => {
    const harness = createGateway(createContext());
    await expect(
      duplicateInvoiceDraft(harness.gateway, {
        sourceInvoiceNumber: "MISSING-202610-01",
        paymentDueDate: "2026-11-30",
        today: "2026-10-25",
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);
    expect(harness.savedInvoice()).toBeUndefined();
  });
});
