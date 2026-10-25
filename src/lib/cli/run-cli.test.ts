import { describe, expect, it } from "vitest";

import type { InvoiceCreationGateway } from "../application/create-invoice-draft";
import type { Invoice } from "../domain/model";
import { serializeInvoice } from "../persistence/yaml-serializer";
import { runCli, type CliDependencies, type CliIo } from "./run-cli";

function createHarness(overrides: Partial<CliDependencies> = {}) {
  let stdout = "";
  let stderr = "";
  let savedInvoice: Invoice | undefined;
  let gatewayDataDirectory: string | undefined;
  let updateGatewayDataDirectory: string | undefined;
  let lastReadInputPath: string | undefined;
  const inputSources = new Map<string, string>();
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
        invoices: savedInvoice === undefined ? [] : [savedInvoice],
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
    createUpdateGateway(dataDirectory) {
      updateGatewayDataDirectory = dataDirectory;
      return {
        async loadUpdateContext() {
          const context = await gateway.loadCreationContext();
          return {
            invoice: savedInvoice,
            issuer: context.issuers[0],
            taxCategories: context.taxCategories,
          };
        },
        async saveUpdatedInvoice(_current, updated) {
          savedInvoice = updated;
          return {
            filePath: `sales/invoices/${updated.transactionDate.slice(0, 4)}/${updated.invoiceNumber}.yaml`,
          };
        },
      };
    },
    async readInput(path) {
      lastReadInputPath = path;
      const source = inputSources.get(path);
      if (source === undefined) {
        throw new Error(`入力 ${path} がありません。`);
      }
      return source;
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
    updateGatewayDataDirectory: () => updateGatewayDataDirectory,
    lastReadInputPath: () => lastReadInputPath,
    setInput: (path: string, source: string) => inputSources.set(path, source),
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

  it("invoice updateでファイルの完全なYAMLから下書きを更新する", async () => {
    const harness = createHarness();
    await runCli(
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
    const current = harness.savedInvoice();
    expect(current).toBeDefined();
    harness.setInput(
      "updated.yaml",
      serializeInvoice({ ...current!, notes: "更新後" }),
    );

    const exitCode = await runCli(
      [
        "node",
        "keiri",
        "invoice",
        "update",
        "ACME-202610-01",
        "--input",
        "updated.yaml",
      ],
      harness.dependencies,
      harness.io,
    );

    expect(exitCode).toBe(0);
    expect(harness.updateGatewayDataDirectory()).toBe("/work/keiri-data");
    expect(harness.lastReadInputPath()).toBe("updated.yaml");
    expect(harness.savedInvoice()).toMatchObject({
      revision: 2,
      notes: "更新後",
    });
    expect(harness.stdout()).toContain(
      "操作結果: 請求書の下書きを更新しました。",
    );
    expect(harness.stdout()).toContain("リビジョン: 2");
  });

  it("--input -を標準入力として同じYAML解析へ渡す", async () => {
    const harness = createHarness();
    await runCli(
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
    harness.setInput("-", serializeInvoice(harness.savedInvoice()!));

    const exitCode = await runCli(
      ["node", "keiri", "invoice", "update", "ACME-202610-01", "--input", "-"],
      harness.dependencies,
      harness.io,
    );
    expect(exitCode).toBe(0);
    expect(harness.lastReadInputPath()).toBe("-");
  });

  it("更新入力のYAML構文エラーを対象名付きで標準エラーへ出力する", async () => {
    const harness = createHarness();
    harness.setInput("broken.yaml", "revision: [\n");
    const exitCode = await runCli(
      [
        "node",
        "keiri",
        "invoice",
        "update",
        "ACME-202610-01",
        "--input",
        "broken.yaml",
      ],
      harness.dependencies,
      harness.io,
    );
    expect(exitCode).toBe(1);
    expect(harness.stderr()).toContain(
      "broken.yaml の読み込みに失敗しました。",
    );
    expect(harness.savedInvoice()).toBeUndefined();
  });

  it("invoice duplicateで既存請求書から新しい下書きを複製する", async () => {
    const harness = createHarness();
    await runCli(
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

    const exitCode = await runCli(
      [
        "node",
        "keiri",
        "invoice",
        "duplicate",
        "ACME-202610-01",
        "--payment-due-date",
        "2026-12-31",
        "--issue-date",
        "2026-10-26",
      ],
      harness.dependencies,
      harness.io,
    );

    expect(exitCode).toBe(0);
    expect(harness.savedInvoice()).toMatchObject({
      invoiceNumber: "ACME-202610-02",
      issueDate: "2026-10-26",
      transactionDate: "2026-10-26",
      paymentDueDate: "2026-12-31",
      revision: 1,
    });
    expect(harness.stdout()).toContain(
      "操作結果: 請求書の下書きを複製しました。",
    );
  });
});
