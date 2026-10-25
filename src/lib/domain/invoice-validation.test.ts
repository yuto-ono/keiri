import { describe, expect, it } from "vitest";

import type { Invoice } from "./model";
import { validateInvoiceForIssue } from "./invoice-validation";

function createInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    revision: 1,
    status: "draft",
    invoiceNumber: "ACME-202610-01",
    businessPartner: {
      code: "ACME",
      snapshot: { addressee: "株式会社サンプル", honorific: "御中" },
    },
    issuer: {
      id: "sole-proprietor",
      snapshot: {
        name: "山田太郎",
        registrationNumber: "T0000000000000",
        phone: { visible: false },
        email: { visible: false },
        bankAccounts: [
          {
            id: "primary",
            bankName: "サンプル銀行",
            branchName: "本店",
            branchCode: "001",
            accountType: "ordinary",
            accountNumber: "1234567",
            accountHolderName: "ヤマダタロウ",
          },
        ],
      },
    },
    issueDate: "2026-10-01",
    transactionDate: "2026-10-01",
    paymentDueDate: "2026-11-30",
    paymentCompletedDate: null,
    unitPricesIncludeTax: false,
    lineItems: [
      {
        name: "システム開発業務",
        quantity: 10.5,
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

describe("請求書の発行前検証", () => {
  it("発行可能な下書きなら問題を返さない", () => {
    expect(validateInvoiceForIssue(createInvoice(), "2026-10-01")).toEqual([]);
  });

  it("未来の取引日は発行を妨げない", () => {
    const invoice = createInvoice({ transactionDate: "2027-01-01" });
    expect(validateInvoiceForIssue(invoice, "2026-10-01")).toEqual([]);
  });

  it("未来の発行日、発行日前の支払期限、明細0件、振込先0件をまとめて返す", () => {
    const invoice = createInvoice({
      issueDate: "2026-10-02",
      paymentDueDate: "2026-10-01",
      lineItems: [],
      issuer: {
        ...createInvoice().issuer,
        snapshot: {
          ...createInvoice().issuer.snapshot,
          bankAccounts: [],
        },
      },
    });

    expect(validateInvoiceForIssue(invoice, "2026-10-01")).toEqual([
      {
        path: ["issueDate"],
        message: "未来の発行日を持つ請求書は、その日まで発行できません。",
      },
      {
        path: ["paymentDueDate"],
        message: "支払期限は発行日以降にしてください。",
      },
      {
        path: ["lineItems"],
        message: "発行する請求書の明細は1件以上10件以下にしてください。",
      },
      {
        path: ["issuer", "snapshot", "bankAccounts"],
        message: "発行する請求書には振込先が1件以上必要です。",
      },
    ]);
  });

  it("未完成の明細を拒否する", () => {
    const invoice = createInvoice({
      lineItems: [
        {
          name: "",
          quantity: 1,
          unit: "",
          unitPrice: 1_000,
          taxCategoryId: "standard-10",
        },
      ],
    });

    expect(validateInvoiceForIssue(invoice, "2026-10-01")).toHaveLength(2);
  });
});
