import { describe, expect, it } from "vitest";

import type {
  BusinessPartner,
  Invoice,
  Issuer,
  TaxCategories,
} from "../domain/model";
import { type KeiriDataSet, validateDataIntegrity } from "./data-integrity";

const issuer: Issuer = {
  revision: 1,
  id: "sole-proprietor",
  name: "山田太郎",
  registrationNumber: "T0000000000000",
  phone: "00-0000-0000",
  email: null,
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
  defaultBankAccountId: "primary",
};

const partner: BusinessPartner = {
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
    bankAccountIds: ["primary"],
  },
  pdfFileNamePattern: "{businessPartnerCode}-{issueDate:YYYYMM}-{sequence}",
};

const taxCategories: TaxCategories = {
  revision: 1,
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
};

const invoice: Invoice = {
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
      phone: { visible: true, value: "00-0000-0000" },
      email: { visible: false },
      bankAccounts: issuer.bankAccounts,
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
      quantity: 1,
      unit: "式",
      unitPrice: 10_000,
      taxCategoryId: "standard-10",
    },
  ],
  notes: null,
  rounding: { lineAmount: "floor", taxAmount: "floor" },
  pdf: { fileNameOverride: null, issuedFileName: null },
};

function createDataSet(): KeiriDataSet {
  return {
    businessPartners: [
      { filePath: "business-partners/ACME.yaml", data: partner },
    ],
    issuers: [{ filePath: "issuers/sole-proprietor.yaml", data: issuer }],
    taxCategories: { filePath: "tax-categories.yaml", data: taxCategories },
    invoices: [
      {
        filePath: "sales/invoices/2026/ACME-202610-01.yaml",
        data: invoice,
      },
    ],
  };
}

describe("データ全体の整合性検証", () => {
  it("有効なデータセットを受け入れる", () => {
    expect(validateDataIntegrity(createDataSet())).toEqual([]);
  });

  it("識別子の大文字・小文字を区別しない重複を検出する", () => {
    const dataSet = createDataSet();
    dataSet.businessPartners = [
      ...dataSet.businessPartners,
      {
        filePath: "business-partners/acme.yaml",
        data: { ...partner, code: "acme" },
      },
    ];
    dataSet.taxCategories.data = {
      ...taxCategories,
      taxCategories: [
        ...taxCategories.taxCategories,
        { ...taxCategories.taxCategories[0], id: "STANDARD-10" },
      ],
    };

    const messages = validateDataIntegrity(dataSet).map(
      (issue) => issue.message,
    );
    expect(
      messages.some((message) => message.includes("取引先コード acme")),
    ).toBe(true);
    expect(
      messages.some((message) => message.includes("税区分ID STANDARD-10")),
    ).toBe(true);
  });

  it("発行者の振込先と取引先の表示設定を検証する", () => {
    const dataSet = createDataSet();
    dataSet.issuers = [
      {
        filePath: "issuers/sole-proprietor.yaml",
        data: {
          ...issuer,
          phone: null,
          bankAccounts: [
            ...issuer.bankAccounts,
            { ...issuer.bankAccounts[0], id: "PRIMARY" },
          ],
          defaultBankAccountId: "missing",
        },
      },
    ];
    dataSet.businessPartners = [
      {
        filePath: "business-partners/ACME.yaml",
        data: {
          ...partner,
          issuerDisplay: {
            ...partner.issuerDisplay,
            bankAccountIds: ["primary", "missing"],
          },
        },
      },
    ];

    const messages = validateDataIntegrity(dataSet).map(
      (issue) => issue.message,
    );
    expect(messages.some((message) => message.includes("大文字・小文字"))).toBe(
      true,
    );
    expect(messages.some((message) => message.includes("既定の振込先"))).toBe(
      true,
    );
    expect(messages.some((message) => message.includes("電話番号がない"))).toBe(
      true,
    );
    expect(
      messages.some((message) => message.includes("missing が存在しません")),
    ).toBe(true);
  });

  it("請求書の参照、番号、配置先、支払期限、税区分をまとめて検証する", () => {
    const dataSet = createDataSet();
    dataSet.invoices = [
      {
        filePath: "sales/invoices/2025/wrong.yaml",
        data: {
          ...invoice,
          invoiceNumber: "OTHER-202609-00",
          businessPartner: { ...invoice.businessPartner, code: "OTHER" },
          issuer: { ...invoice.issuer, id: "missing" },
          paymentDueDate: "2026-09-30",
          lineItems: [
            { ...invoice.lineItems[0], taxCategoryId: "missing" },
            { ...invoice.lineItems[0], taxCategoryId: "standard-10" },
          ],
        },
      },
    ];

    const messages = validateDataIntegrity(dataSet).map(
      (issue) => issue.message,
    );
    expect(messages.some((message) => message.includes("配置先は"))).toBe(true);
    expect(messages.some((message) => message.includes("取引先 OTHER"))).toBe(
      true,
    );
    expect(messages.some((message) => message.includes("発行者 missing"))).toBe(
      true,
    );
    expect(messages.some((message) => message.includes("2桁連番"))).toBe(true);
    expect(
      messages.some((message) => message.includes("支払期限は発行日以降")),
    ).toBe(true);
    expect(messages.some((message) => message.includes("税区分 missing"))).toBe(
      true,
    );
    expect(
      messages.some((message) => message.includes("すべての明細に同じ")),
    ).toBe(true);
  });

  it("廃止された標準税率は既存請求書の参照として維持できる", () => {
    const dataSet = createDataSet();
    dataSet.taxCategories.data = {
      ...taxCategories,
      taxCategories: [{ ...taxCategories.taxCategories[0], deprecated: true }],
    };
    expect(validateDataIntegrity(dataSet)).toEqual([]);
  });

  it("発行済み請求書には明細と振込先が必要である", () => {
    const dataSet = createDataSet();
    dataSet.invoices = [
      {
        filePath: "sales/invoices/2026/ACME-202610-01.yaml",
        data: {
          ...invoice,
          status: "issued",
          lineItems: [],
          issuer: {
            ...invoice.issuer,
            snapshot: { ...invoice.issuer.snapshot, bankAccounts: [] },
          },
          pdf: { ...invoice.pdf, issuedFileName: "invoice.pdf" },
        },
      },
    ];

    const messages = validateDataIntegrity(dataSet).map(
      (issue) => issue.message,
    );
    expect(
      messages.some((message) => message.includes("明細は1件以上10件以下")),
    ).toBe(true);
    expect(
      messages.some((message) => message.includes("振込先が1件以上")),
    ).toBe(true);
  });
});
