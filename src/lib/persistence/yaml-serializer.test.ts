import { describe, expect, it } from "vitest";

import type { BusinessPartner, Invoice, Issuer } from "../domain/model";
import {
  businessPartnerSchema,
  invoiceSchema,
  issuerSchema,
  settingsSchema,
  taxCategoriesSchema,
} from "./schemas";
import {
  serializeBusinessPartner,
  serializeInvoice,
  serializeIssuer,
  serializeSettings,
  serializeTaxCategories,
} from "./yaml-serializer";
import { parseYaml } from "./yaml-parser";

const bankAccount = {
  id: "primary",
  bankName: "サンプル銀行",
  branchName: "本店",
  branchCode: "001",
  accountType: "ordinary" as const,
  accountNumber: "1234567",
  accountHolderName: "ヤマダタロウ",
};

const businessPartner: BusinessPartner = {
  revision: 1,
  code: "ACME",
  addressee: "株式会社サンプル",
  honorific: "御中",
  requiresMonthlyInvoice: true,
  billingInstructions: "毎月月初に前月分を請求する。\r\n\r\n末日払い。\n\n",
  unitPricesIncludeTax: false,
  issuerDisplay: {
    phone: true,
    email: false,
    bankAccountIds: ["primary"],
  },
  pdfFileNamePattern: "{businessPartnerCode}-{issueDate:YYYYMM}-{sequence}",
};

const issuer: Issuer = {
  revision: 1,
  id: "sole-proprietor",
  name: "山田太郎",
  registrationNumber: "T0000000000000",
  phone: "00-0000-0000",
  email: null,
  bankAccounts: [bankAccount],
  defaultBankAccountId: "primary",
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
      bankAccounts: [bankAccount],
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
  notes: "1行目\n\n3行目\n\n",
  rounding: { lineAmount: "floor", taxAmount: "floor" },
  pdf: { fileNameOverride: null, issuedFileName: null },
};

describe("YAML出力", () => {
  it("取引先を固定キー順、LF、リテラルブロックで出力する", () => {
    const yaml = serializeBusinessPartner(businessPartner);

    expect(yaml).toBe(`revision: 1
code: ACME
addressee: 株式会社サンプル
honorific: 御中
requiresMonthlyInvoice: true
billingInstructions: |-
  毎月月初に前月分を請求する。

  末日払い。
unitPricesIncludeTax: false
issuerDisplay:
  phone: true
  email: false
  bankAccountIds:
    - primary
pdfFileNamePattern: "{businessPartnerCode}-{issueDate:YYYYMM}-{sequence}"
`);
    expect(parseYaml(yaml, "partner.yaml", businessPartnerSchema)).toEqual({
      ...businessPartner,
      billingInstructions: "毎月月初に前月分を請求する。\n\n末日払い。",
    });
  });

  it("先頭ゼロを持つ文字列を引用して発行者を往復できる", () => {
    const yaml = serializeIssuer(issuer);
    expect(yaml).toContain('branchCode: "001"');
    expect(yaml).toContain('accountNumber: "1234567"');
    expect(parseYaml(yaml, "issuer.yaml", issuerSchema)).toEqual(issuer);
  });

  it("請求書の複数行備考を正規化して往復できる", () => {
    const yaml = serializeInvoice(invoice);
    expect(yaml).toContain("notes: |-\n  1行目\n\n  3行目\n");
    expect(parseYaml(yaml, "invoice.yaml", invoiceSchema)).toEqual({
      ...invoice,
      notes: "1行目\n\n3行目",
    });
  });

  it("税区分と設定を固定構造で往復できる", () => {
    const taxCategories = {
      revision: 1,
      taxCategories: [
        {
          id: "standard-10",
          name: "標準10%",
          treatment: "taxable" as const,
          deprecated: false,
          isStandardRate: true,
          ratePercent: 10,
        },
      ],
    };
    const settings = {
      revision: 1,
      rounding: { lineAmount: "floor" as const, taxAmount: "floor" as const },
    };

    expect(
      parseYaml(
        serializeTaxCategories(taxCategories),
        "tax-categories.yaml",
        taxCategoriesSchema,
      ),
    ).toEqual(taxCategories);
    expect(
      parseYaml(serializeSettings(settings), "settings.yaml", settingsSchema),
    ).toEqual(settings);
  });

  it("出力末尾の改行を1つに統一する", () => {
    const yaml = serializeInvoice(invoice);
    expect(yaml.endsWith("\n")).toBe(true);
    expect(yaml.endsWith("\n\n")).toBe(false);
    expect(yaml).not.toContain("\r");
  });
});
