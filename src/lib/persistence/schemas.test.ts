import { describe, expect, it } from "vitest";

import { DataValidationError } from "./data-validation-error";
import {
  businessPartnerSchema,
  invoiceSchema,
  issuerSchema,
  settingsSchema,
  taxCategoriesSchema,
} from "./schemas";
import { parseYaml } from "./yaml-parser";

const businessPartnerYaml = `revision: 1
code: ACME
addressee: 株式会社サンプル
honorific: 御中
requiresMonthlyInvoice: true
billingInstructions: |-
  毎月月初に前月分を請求する。
  稼働時間は外部で集計して明細の数量へ入力する。
unitPricesIncludeTax: false
issuerDisplay:
  phone: true
  email: false
  bankAccountIds:
    - primary
pdfFileNamePattern: "{businessPartnerCode}-{invoiceDate:YYYYMM}-{sequence}"
`;

const issuerYaml = `revision: 1
id: sole-proprietor
name: 山田太郎
registrationNumber: T0000000000000
phone: 00-0000-0000
email: null
bankAccounts:
  - id: primary
    bankName: サンプル銀行
    branchName: 本店
    branchCode: "001"
    accountType: ordinary
    accountNumber: "1234567"
    accountHolderName: ヤマダタロウ
defaultBankAccountId: primary
`;

const invoiceYaml = `revision: 1
status: draft
invoiceNumber: ACME-202610-01
businessPartner:
  code: ACME
  snapshot:
    addressee: 株式会社サンプル
    honorific: 御中
issuer:
  id: sole-proprietor
  snapshot:
    name: 山田太郎
    registrationNumber: T0000000000000
    phone:
      visible: true
      value: 00-0000-0000
    email:
      visible: false
    bankAccounts:
      - id: primary
        bankName: サンプル銀行
        branchName: 本店
        branchCode: "001"
        accountType: ordinary
        accountNumber: "1234567"
        accountHolderName: ヤマダタロウ
invoiceDate: "2026-10-01"
paymentDueDate: "2026-11-30"
paymentCompletedDate: null
unitPricesIncludeTax: false
lineItems:
  - name: システム開発業務
    quantity: 10.5
    unit: 時間
    unitPrice: 10000
    taxCategoryId: standard-10
notes: null
rounding:
  lineAmount: floor
  taxAmount: floor
pdf:
  fileNameOverride: null
  issuedFileName: null
`;

describe("永続化スキーマ", () => {
  it("仕様書の取引先例を受け入れる", () => {
    const result = parseYaml(
      businessPartnerYaml,
      "business-partners/ACME.yaml",
      businessPartnerSchema,
    );
    expect(result.code).toBe("ACME");
    expect(result.billingInstructions).toContain("稼働時間");
  });

  it("仕様書の発行者例を文字列の先頭ゼロを保って受け入れる", () => {
    const result = parseYaml(
      issuerYaml,
      "issuers/sole-proprietor.yaml",
      issuerSchema,
    );
    expect(result.bankAccounts[0].branchCode).toBe("001");
    expect(result.bankAccounts[0].accountNumber).toBe("1234567");
  });

  it("省略可能な請求指示をnullとして読み、ほかの必須項目の省略は拒否する", () => {
    const withoutInstructions = businessPartnerYaml.replace(
      /^billingInstructions: \|-\n(?: {2}.*\n)*/m,
      "",
    );
    const result = parseYaml(
      withoutInstructions,
      "business-partners/ACME.yaml",
      businessPartnerSchema,
    );
    expect(result.billingInstructions).toBeNull();
    expect(() =>
      parseYaml(
        withoutInstructions.replace("code: ACME\n", ""),
        "business-partners/ACME.yaml",
        businessPartnerSchema,
      ),
    ).toThrow(DataValidationError);
  });

  it("仕様書の請求書例を受け入れる", () => {
    const result = parseYaml(
      invoiceYaml,
      "sales/invoices/2026/ACME-202610-01.yaml",
      invoiceSchema,
    );
    expect(result.lineItems[0].quantity).toBe(10.5);
    expect(result.issuer.snapshot.email).toEqual({ visible: false });
  });

  it.each(["issueDate", "transactionDate"])(
    "旧日付項目 %s を許可しない",
    (key) => {
      expectDataIssues(
        `${invoiceYaml}${key}: "2026-10-01"\n`,
        invoiceSchema,
        ["Unrecognized key"],
      );
    },
  );

  it.each(["", "2026-02-30", "2026-1-01"])("不正な請求日 %j を拒否する", (date) => {
    expect(() =>
      parseYaml(
        invoiceYaml.replace(
          'invoiceDate: "2026-10-01"',
          `invoiceDate: "${date}"`,
        ),
        "sales/invoices/2026/ACME-202610-01.yaml",
        invoiceSchema,
      ),
    ).toThrow(DataValidationError);
  });

  it("旧日付項目だけでは請求日の代用にならない", () => {
    expectDataIssues(
      invoiceYaml.replace("invoiceDate:", "issueDate:") +
        'transactionDate: "2026-10-01"\n',
      invoiceSchema,
      ["Unrecognized keys", "string"],
    );
  });

  it("設定と税区分の初期データを受け入れる", () => {
    expect(
      parseYaml(
        "revision: 1\nrounding:\n  lineAmount: floor\n  taxAmount: floor\n",
        "settings.yaml",
        settingsSchema,
      ).rounding,
    ).toEqual({ lineAmount: "floor", taxAmount: "floor" });

    expect(
      parseYaml(
        "revision: 1\ntaxCategories:\n  - id: standard-10\n    name: 標準10%\n    treatment: taxable\n    deprecated: false\n    isStandardRate: true\n    ratePercent: 10\n",
        "tax-categories.yaml",
        taxCategoriesSchema,
      ).taxCategories,
    ).toHaveLength(1);
  });

  it("下書きの入金完了日と発行済みPDF名を拒否する", () => {
    const invalid = invoiceYaml
      .replace(
        "paymentCompletedDate: null",
        'paymentCompletedDate: "2026-10-10"',
      )
      .replace("issuedFileName: null", "issuedFileName: invoice.pdf");

    expectDataIssues(invalid, invoiceSchema, [
      "下書きでは入金完了日をnull",
      "下書きでは発行済みPDFファイル名をnull",
    ]);
  });

  it("発行済み請求書には小文字.pdfのファイル名を要求する", () => {
    const invalid = invoiceYaml
      .replace("status: draft", "status: issued")
      .replace("issuedFileName: null", "issuedFileName: invoice.PDF");

    expectDataIssues(invalid, invoiceSchema, [".pdfで終わるファイル名"]);
  });

  it("安全な整数でない単価を拒否する", () => {
    const invalid = invoiceYaml.replace(
      "unitPrice: 10000",
      "unitPrice: 9007199254740992",
    );
    expectDataIssues(invalid, invoiceSchema, ["安全に扱えない整数"]);
  });

  it("課税以外の税区分に税率の余分なキーを許可しない", () => {
    const invalid = `revision: 1
taxCategories:
  - id: exempt
    name: 免税
    treatment: taxExempt
    deprecated: false
    isStandardRate: false
    ratePercent: 0
`;
    expectDataIssues(invalid, taxCategoriesSchema, ["Unrecognized keys"]);
  });
});

function expectDataIssues<T>(
  source: string,
  schema: Parameters<typeof parseYaml<T>>[2],
  expectedMessages: readonly string[],
): void {
  try {
    parseYaml(source, "sample.yaml", schema);
    expect.fail("DataValidationError が必要です");
  } catch (error) {
    expect(error).toBeInstanceOf(DataValidationError);
    const messages = (error as DataValidationError).issues.map(
      (issue) => issue.message,
    );
    for (const expected of expectedMessages) {
      expect(messages.some((message) => message.includes(expected))).toBe(true);
    }
  }
}
