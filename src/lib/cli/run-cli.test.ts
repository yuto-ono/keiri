import { describe, expect, it } from "vitest";

import type { InvoiceCreationGateway } from "../application/create-invoice-draft";
import type { Invoice } from "../domain/model";
import { runCli, type CliDependencies, type CliIo } from "./run-cli";

function createHarness(overrides: Partial<CliDependencies> = {}) {
  let stdout = "";
  let stderr = "";
  let savedInvoice: Invoice | undefined;
  let gatewayDataDirectory: string | undefined;
  const gateway: InvoiceCreationGateway = {
    async loadCreationContext() {
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
              phone: false,
              email: false,
              bankAccountIds: ["primary"],
            },
            pdfFileNamePattern:
              "{businessPartnerCode}-{issueDate:YYYYMM}-{sequence}",
          },
        ],
        issuers: [
          {
            revision: 1,
            id: "issuer",
            name: "発行者",
            registrationNumber: "T0000000000000",
            phone: null,
            email: null,
            bankAccounts: [
              {
                id: "primary",
                bankName: "銀行",
                branchName: "本店",
                branchCode: null,
                accountType: "ordinary",
                accountNumber: "1234567",
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
          revision: 1,
          rounding: { lineAmount: "floor", taxAmount: "floor" },
        },
        invoices: [],
      };
    },
    async saveNewInvoice(invoice) {
      savedInvoice = invoice;
      return {
        filePath: `sales/invoices/2026/${invoice.invoiceNumber}.yaml`,
      };
    },
  };
  const dependencies: CliDependencies = {
    repositoryRoot: "/work/keiri",
    environment: { KEIRI_DATA_DIR: "../keiri-data" },
    today: "2026-10-25",
    createGateway(dataDirectory) {
      gatewayDataDirectory = dataDirectory;
      return gateway;
    },
    ...overrides,
  };
  const io: CliIo = {
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
  };
  return {
    dependencies,
    io,
    stdout: () => stdout,
    stderr: () => stderr,
    savedInvoice: () => savedInvoice,
    gatewayDataDirectory: () => gatewayDataDirectory,
  };
}

describe("keiri CLI", () => {
  it("invoice createで下書きを作成し固定ラベルを出力する", async () => {
    const harness = createHarness();
    const exitCode = await runCli(
      [
        "node",
        "keiri",
        "invoice",
        "create",
        "ACME",
        "--payment-due-date",
        "2026-11-30",
      ],
      harness.dependencies,
      harness.io,
    );

    expect(exitCode).toBe(0);
    expect(harness.gatewayDataDirectory()).toBe("/work/keiri-data");
    expect(harness.savedInvoice()?.invoiceNumber).toBe("ACME-202610-01");
    expect(harness.stdout()).toBe(
      [
        "操作結果: 請求書の下書きを作成しました。",
        "請求書番号: ACME-202610-01",
        "YAML保存先: sales/invoices/2026/ACME-202610-01.yaml",
        "リビジョン: 1",
        "",
      ].join("\n"),
    );
    expect(harness.stderr()).toBe("");
  });

  it("発行日オプションをapplication層へ渡す", async () => {
    const harness = createHarness();
    const exitCode = await runCli(
      [
        "node",
        "keiri",
        "invoice",
        "create",
        "ACME",
        "--payment-due-date",
        "2027-01-31",
        "--issue-date",
        "2026-12-01",
      ],
      harness.dependencies,
      harness.io,
    );
    expect(exitCode).toBe(0);
    expect(harness.savedInvoice()?.issueDate).toBe("2026-12-01");
  });

  it("必須オプション不足を日本語で標準エラーへ出力する", async () => {
    const harness = createHarness();
    const exitCode = await runCli(
      ["node", "keiri", "invoice", "create", "ACME"],
      harness.dependencies,
      harness.io,
    );
    expect(exitCode).not.toBe(0);
    expect(harness.stdout()).toBe("");
    expect(harness.stderr()).toContain(
      "必須のオプションが指定されていません。",
    );
    expect(harness.stderr()).toContain("--payment-due-date");
    expect(harness.savedInvoice()).toBeUndefined();
  });

  it("業務検証エラーを対象項目と理由付きで標準エラーへ出力する", async () => {
    const harness = createHarness();
    const exitCode = await runCli(
      [
        "node",
        "keiri",
        "invoice",
        "create",
        "MISSING",
        "--payment-due-date",
        "2026-11-30",
      ],
      harness.dependencies,
      harness.io,
    );
    expect(exitCode).toBe(1);
    expect(harness.stderr()).toContain("請求書を作成できません。");
    expect(harness.stderr()).toContain("businessPartnerCode");
    expect(harness.stderr()).toContain("取引先 MISSING が存在しません。");
  });

  it("日本語のヘルプを表示する", async () => {
    const harness = createHarness();
    const exitCode = await runCli(
      ["node", "keiri", "invoice", "create", "--help"],
      harness.dependencies,
      harness.io,
    );
    expect(exitCode).toBe(0);
    expect(harness.stdout()).toContain("使用方法:");
    expect(harness.stdout()).toContain("オプション:");
    expect(harness.stdout()).toContain("支払期限");
    expect(harness.stdout()).not.toContain("Usage:");
    expect(harness.stderr()).toBe("");
  });

  it("KEIRI_DATA_DIR未指定を日本語で拒否する", async () => {
    const harness = createHarness({ environment: {} });
    const exitCode = await runCli(
      [
        "node",
        "keiri",
        "invoice",
        "create",
        "ACME",
        "--payment-due-date",
        "2026-11-30",
      ],
      harness.dependencies,
      harness.io,
    );
    expect(exitCode).toBe(1);
    expect(harness.stderr()).toContain("KEIRI_DATA_DIR");
  });
});
