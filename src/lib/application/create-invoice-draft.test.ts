import { describe, expect, it } from "vitest";

import { DomainValidationError } from "../domain/domain-validation-error";
import type { Invoice } from "../domain/model";
import {
  createInvoiceDraft,
  type InvoiceCreationContext,
  type InvoiceCreationGateway,
} from "./create-invoice-draft";

function createContext(): InvoiceCreationContext {
  return {
    businessPartners: [
      {
        revision: 1,
        code: "ACME",
        addressee: "株式会社サンプル",
        honorific: "御中",
        requiresMonthlyInvoice: true,
        billingInstructions: null,
        unitPricesIncludeTax: false,
        issuerDisplay: {
          phone: true,
          email: false,
          bankAccountIds: ["secondary", "primary"],
        },
        pdfFileNamePattern:
          "{businessPartnerCode}-{issueDate:YYYYMM}-{sequence}",
      },
    ],
    issuers: [
      {
        revision: 1,
        id: "sole-proprietor",
        name: "山田太郎",
        registrationNumber: "T0000000000000",
        phone: "00-0000-0000",
        email: null,
        bankAccounts: [
          {
            id: "primary",
            bankName: "第一銀行",
            branchName: "本店",
            branchCode: "001",
            accountType: "ordinary",
            accountNumber: "1234567",
            accountHolderName: "ヤマダタロウ",
          },
          {
            id: "secondary",
            bankName: "第二銀行",
            branchName: "本店",
            branchCode: null,
            accountType: "checking",
            accountNumber: "7654321",
            accountHolderName: "ヤマダタロウ",
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
      revision: 1,
      rounding: { lineAmount: "halfUp", taxAmount: "floor" },
    },
    invoices: [],
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
  return { gateway, getSavedInvoice: () => savedInvoice };
}

describe("請求書下書きの新規作成", () => {
  it("採番し、取引先・発行者・設定のスナップショットを保存する", async () => {
    const { gateway, getSavedInvoice } = createGateway(createContext());
    const result = await createInvoiceDraft(gateway, {
      businessPartnerCode: "ACME",
      paymentDueDate: "2026-11-30",
      today: "2026-10-25",
    });

    expect(result.filePath).toBe("sales/invoices/2026/ACME-202610-01.yaml");
    expect(result.invoice).toMatchObject({
      revision: 1,
      status: "draft",
      invoiceNumber: "ACME-202610-01",
      issueDate: "2026-10-25",
      transactionDate: "2026-10-25",
      paymentDueDate: "2026-11-30",
      paymentCompletedDate: null,
      unitPricesIncludeTax: false,
      lineItems: [],
      notes: null,
      rounding: { lineAmount: "halfUp", taxAmount: "floor" },
      pdf: { fileNameOverride: null, issuedFileName: null },
    });
    expect(result.invoice.businessPartner.snapshot).toEqual({
      addressee: "株式会社サンプル",
      honorific: "御中",
    });
    expect(result.invoice.issuer.snapshot.phone).toEqual({
      visible: true,
      value: "00-0000-0000",
    });
    expect(result.invoice.issuer.snapshot.email).toEqual({ visible: false });
    expect(
      result.invoice.issuer.snapshot.bankAccounts.map((account) => account.id),
    ).toEqual(["secondary", "primary"]);
    expect(getSavedInvoice()).toBe(result.invoice);
  });

  it("指定した発行日を発行日と取引日の初期値にする", async () => {
    const { gateway } = createGateway(createContext());
    const result = await createInvoiceDraft(gateway, {
      businessPartnerCode: "ACME",
      paymentDueDate: "2027-01-31",
      issueDate: "2026-12-01",
      today: "2026-10-25",
    });
    expect(result.invoice.issueDate).toBe("2026-12-01");
    expect(result.invoice.transactionDate).toBe("2026-12-01");
    expect(result.invoice.invoiceNumber).toBe("ACME-202612-01");
  });

  it("途中の欠番を埋めず、最大の連番の次を採番する", async () => {
    const context = createContext();
    const baseInvoice = (
      await createInvoiceDraft(createGateway(context).gateway, {
        businessPartnerCode: "ACME",
        paymentDueDate: "2026-11-30",
        today: "2026-10-25",
      })
    ).invoice;
    context.invoices = [
      baseInvoice,
      { ...baseInvoice, invoiceNumber: "ACME-202610-03" },
    ];

    const result = await createInvoiceDraft(createGateway(context).gateway, {
      businessPartnerCode: "ACME",
      paymentDueDate: "2026-11-30",
      today: "2026-10-25",
    });
    expect(result.invoice.invoiceNumber).toBe("ACME-202610-04");
  });

  it("最新番号が削除されて存在しなければ次回の採番で再利用する", async () => {
    const context = createContext();
    const first = (
      await createInvoiceDraft(createGateway(context).gateway, {
        businessPartnerCode: "ACME",
        paymentDueDate: "2026-11-30",
        today: "2026-10-25",
      })
    ).invoice;
    context.invoices = [first];

    const result = await createInvoiceDraft(createGateway(context).gateway, {
      businessPartnerCode: "ACME",
      paymentDueDate: "2026-11-30",
      today: "2026-10-25",
    });
    expect(result.invoice.invoiceNumber).toBe("ACME-202610-02");
  });

  it("支払期限が発行日より前でも下書きとして保存できる", async () => {
    const { gateway } = createGateway(createContext());
    await expect(
      createInvoiceDraft(gateway, {
        businessPartnerCode: "ACME",
        paymentDueDate: "2026-09-30",
        today: "2026-10-25",
      }),
    ).resolves.toBeDefined();
  });

  it("採番可能な連番がなければ拒否する", async () => {
    const context = createContext();
    const first = (
      await createInvoiceDraft(createGateway(context).gateway, {
        businessPartnerCode: "ACME",
        paymentDueDate: "2026-11-30",
        today: "2026-10-25",
      })
    ).invoice;
    context.invoices = [{ ...first, invoiceNumber: "ACME-202610-99" }];

    await expect(
      createInvoiceDraft(createGateway(context).gateway, {
        businessPartnerCode: "ACME",
        paymentDueDate: "2026-11-30",
        today: "2026-10-25",
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("標準税率の税区分を一意に決定できなければ拒否する", async () => {
    const context = createContext();
    context.taxCategories = [];

    await expect(
      createInvoiceDraft(createGateway(context).gateway, {
        businessPartnerCode: "ACME",
        paymentDueDate: "2026-11-30",
        today: "2026-10-25",
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("不正な日付をまとめて報告し、データを保存しない", async () => {
    const { gateway, getSavedInvoice } = createGateway(createContext());
    try {
      await createInvoiceDraft(gateway, {
        businessPartnerCode: "ACME",
        paymentDueDate: "2026-02-29",
        issueDate: "2026-13-01",
        today: "invalid",
      });
      expect.fail("DomainValidationError が必要です");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainValidationError);
      expect((error as DomainValidationError).issues).toHaveLength(3);
      expect(getSavedInvoice()).toBeUndefined();
    }
  });
});
