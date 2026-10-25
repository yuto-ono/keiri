import { describe, expect, it, vi } from "vitest";

import {
  createInvoiceDraft,
  type InvoiceCreationGateway,
} from "../application/create-invoice-draft";
import type { InvoicePdfRenderer } from "#lib/application/issue-invoice";
import type { Invoice } from "../domain/model";
import { serializeInvoice } from "../persistence/yaml-serializer";
import { runCli, type CliDependencies, type CliIo } from "./run-cli";

function createHarness(overrides: Partial<CliDependencies> = {}) {
  let stdout = "";
  let stderr = "";
  let savedInvoice: Invoice | undefined;
  let gatewayDataDirectory: string | undefined;
  let updateGatewayDataDirectory: string | undefined;
  let issueGatewayDataDirectory: string | undefined;
  let rendererRepositoryRoot: string | undefined;
  let revertGatewayDataDirectory: string | undefined;
  const renderSinglePagePdf = vi.fn<InvoicePdfRenderer["renderSinglePagePdf"]>(
    async () => new Uint8Array([1, 2, 3]),
  );
  const commitIssuedInvoice = vi.fn(
    async (_current: Invoice, issued: Invoice) => {
      savedInvoice = issued;
      return {
        invoiceFilePath: `sales/invoices/2026/${issued.invoiceNumber}.yaml`,
        pdfFilePath: `documents/2026/sales/invoices/ACME/${issued.pdf.issuedFileName}`,
      };
    },
  );
  const commitRevertedInvoice = vi.fn(
    async (_current: Invoice, draft: Invoice) => {
      savedInvoice = draft;
      return {
        invoiceFilePath: `sales/invoices/2026/${draft.invoiceNumber}.yaml`,
        pdfFilePath: "documents/2026/sales/invoices/ACME/ACME-202610-01.pdf",
      };
    },
  );
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
    createIssueGateway(dataDirectory) {
      issueGatewayDataDirectory = dataDirectory;
      return {
        async loadIssueContext() {
          const context = await gateway.loadCreationContext();
          return {
            invoice: savedInvoice,
            businessPartner: context.businessPartners[0],
            taxCategories: context.taxCategories,
          };
        },
        commitIssuedInvoice,
      };
    },
    createRevertToDraftGateway(dataDirectory) {
      revertGatewayDataDirectory = dataDirectory;
      return {
        async loadInvoice() {
          return savedInvoice;
        },
        commitRevertedInvoice,
      };
    },
    createPdfRenderer(repositoryRoot) {
      rendererRepositoryRoot = repositoryRoot;
      return { renderSinglePagePdf };
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
    issueGatewayDataDirectory: () => issueGatewayDataDirectory,
    rendererRepositoryRoot: () => rendererRepositoryRoot,
    revertGatewayDataDirectory: () => revertGatewayDataDirectory,
    commitRevertedInvoice,
    renderSinglePagePdf,
    commitIssuedInvoice,
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

async function createIssueHarness() {
  const harness = createHarness();
  const { invoice } = await createInvoiceDraft(
    harness.dependencies.createGateway("/work/keiri-data"),
    {
      businessPartnerCode: "ACME",
      paymentDueDate: "2026-11-30",
      today: harness.dependencies.today,
    },
  );
  invoice.lineItems.push({
    name: "開発業務",
    quantity: 1,
    unit: "式",
    unitPrice: 10_000,
    taxCategoryId: "standard-10",
  });
  return harness;
}

describe("請求書発行CLI", () => {
  it("保存済み下書きを発行しPDF保存先と更新後リビジョンを表示する", async () => {
    const harness = await createIssueHarness();
    const exitCode = await runCli(
      [
        "node",
        "keiri",
        "invoice",
        "issue",
        "ACME-202610-01",
        "--revision",
        "1",
      ],
      harness.dependencies,
      harness.io,
    );

    expect(exitCode).toBe(0);
    expect(harness.issueGatewayDataDirectory()).toBe("/work/keiri-data");
    expect(harness.rendererRepositoryRoot()).toBe("/work/keiri");
    expect(harness.savedInvoice()).toMatchObject({
      revision: 2,
      status: "issued",
    });
    expect(harness.stdout()).toBe(
      [
        "操作結果: 請求書を発行しました。",
        "請求書番号: ACME-202610-01",
        "YAML保存先: sales/invoices/2026/ACME-202610-01.yaml",
        "PDF保存先: documents/2026/sales/invoices/ACME/ACME-202610-01.pdf",
        "リビジョン: 2",
        "",
      ].join("\n"),
    );
    expect(harness.renderSinglePagePdf).toHaveBeenCalledOnce();
    expect(harness.commitIssuedInvoice).toHaveBeenCalledOnce();
    expect(harness.stderr()).toBe("");
  });

  it("期待リビジョンの指定を必須にする", async () => {
    const harness = await createIssueHarness();
    const exitCode = await runCli(
      ["node", "keiri", "invoice", "issue", "ACME-202610-01"],
      harness.dependencies,
      harness.io,
    );

    expect(exitCode).not.toBe(0);
    expect(harness.stderr()).toContain(
      "必須のオプションが指定されていません。",
    );
    expect(harness.stderr()).toContain("--revision");
    expect(harness.issueGatewayDataDirectory()).toBeUndefined();
    expect(harness.commitIssuedInvoice).not.toHaveBeenCalled();
    expect(harness.stdout()).toBe("");
  });

  it.each([
    "0",
    "-1",
    "1.5",
    "1abc",
    "0x1",
    "1e0",
    "Infinity",
    "9007199254740992",
  ])("不正な期待リビジョン %s を発行処理の前に拒否する", async (revision) => {
    const harness = createHarness();
    const exitCode = await runCli(
      [
        "node",
        "keiri",
        "invoice",
        "issue",
        "ACME-202610-01",
        "--revision",
        revision,
      ],
      harness.dependencies,
      harness.io,
    );

    expect(exitCode).not.toBe(0);
    expect(harness.stderr()).toContain("1以上の安全な整数");
    expect(harness.stderr()).toContain("--revision");
    expect(harness.issueGatewayDataDirectory()).toBeUndefined();
    expect(harness.renderSinglePagePdf).not.toHaveBeenCalled();
    expect(harness.commitIssuedInvoice).not.toHaveBeenCalled();
    expect(harness.stdout()).toBe("");
  });

  it("リビジョン不一致時はPDFを生成せず下書きを維持する", async () => {
    const harness = await createIssueHarness();
    const before = structuredClone(harness.savedInvoice());
    const exitCode = await runCli(
      [
        "node",
        "keiri",
        "invoice",
        "issue",
        "ACME-202610-01",
        "--revision",
        "2",
      ],
      harness.dependencies,
      harness.io,
    );

    expect(exitCode).toBe(1);
    expect(harness.stderr()).toContain("revision");
    expect(harness.stderr()).toContain("一致しません");
    expect(harness.savedInvoice()).toEqual(before);
    expect(harness.renderSinglePagePdf).not.toHaveBeenCalled();
    expect(harness.commitIssuedInvoice).not.toHaveBeenCalled();
    expect(harness.stdout()).toBe("");
  });

  it("未来の発行日を実行日と照合して拒否する", async () => {
    const harness = await createIssueHarness();
    harness.savedInvoice()!.issueDate = "2026-10-26";
    const exitCode = await runCli(
      [
        "node",
        "keiri",
        "invoice",
        "issue",
        "ACME-202610-01",
        "--revision",
        "1",
      ],
      harness.dependencies,
      harness.io,
    );

    expect(exitCode).toBe(1);
    expect(harness.stderr()).toContain("issueDate");
    expect(harness.renderSinglePagePdf).not.toHaveBeenCalled();
    expect(harness.commitIssuedInvoice).not.toHaveBeenCalled();
  });

  it("PDF生成の失敗理由を標準エラーへ出力し成功を表示しない", async () => {
    const harness = await createIssueHarness();
    const before = structuredClone(harness.savedInvoice());
    harness.renderSinglePagePdf.mockRejectedValueOnce(
      new Error("フォントを読み込めません。"),
    );
    const exitCode = await runCli(
      [
        "node",
        "keiri",
        "invoice",
        "issue",
        "ACME-202610-01",
        "--revision",
        "1",
      ],
      harness.dependencies,
      harness.io,
    );

    expect(exitCode).toBe(1);
    expect(harness.stderr()).toContain("フォントを読み込めません。");
    expect(harness.stdout()).toBe("");
    expect(harness.savedInvoice()).toEqual(before);
    expect(harness.commitIssuedInvoice).not.toHaveBeenCalled();
  });

  it("発行用ヘルプで期待リビジョンを案内する", async () => {
    const harness = createHarness();
    const exitCode = await runCli(
      ["node", "keiri", "invoice", "issue", "--help"],
      harness.dependencies,
      harness.io,
    );
    expect(exitCode).toBe(0);
    expect(harness.stdout()).toContain("--revision <期待リビジョン>");
    expect(harness.stdout()).toContain("正式PDF");
    expect(harness.stderr()).toBe("");
    expect(harness.issueGatewayDataDirectory()).toBeUndefined();
  });
});

async function createRevertToDraftHarness() {
  const harness = await createIssueHarness();
  const invoice = harness.savedInvoice()!;
  invoice.status = "issued";
  invoice.revision = 2;
  invoice.pdf.issuedFileName = "ACME-202610-01.pdf";
  return harness;
}

describe("請求書の下書き戻しCLI", () => {
  it("下書きへ戻し、破棄したPDFパスと更新後リビジョンを表示する", async () => {
    const harness = await createRevertToDraftHarness();
    const exitCode = await runCli(
      [
        "node",
        "keiri",
        "invoice",
        "revert-to-draft",
        "ACME-202610-01",
        "--revision",
        "2",
      ],
      harness.dependencies,
      harness.io,
    );

    expect(exitCode).toBe(0);
    expect(harness.revertGatewayDataDirectory()).toBe("/work/keiri-data");
    expect(harness.savedInvoice()).toMatchObject({
      revision: 3,
      status: "draft",
      pdf: { issuedFileName: null },
    });
    expect(harness.stdout()).toBe(
      [
        "操作結果: 請求書を下書きへ戻しました。",
        "請求書番号: ACME-202610-01",
        "YAML保存先: sales/invoices/2026/ACME-202610-01.yaml",
        "破棄したPDF: documents/2026/sales/invoices/ACME/ACME-202610-01.pdf",
        "リビジョン: 3",
        "",
      ].join("\n"),
    );
    expect(harness.stderr()).toBe("");
    expect(harness.renderSinglePagePdf).not.toHaveBeenCalled();
    expect(harness.commitRevertedInvoice).toHaveBeenCalledOnce();
  });

  it.each([
    { options: [] },
    { options: ["--revision", "0"] },
    { options: ["--revision", "invalid"] },
  ])(
    "期待リビジョンの不足・不正を処理前に拒否する: $options",
    async ({ options }) => {
      const harness = createHarness();
      const exitCode = await runCli(
        [
          "node",
          "keiri",
          "invoice",
          "revert-to-draft",
          "ACME-202610-01",
          ...options,
        ],
        harness.dependencies,
        harness.io,
      );
      expect(exitCode).not.toBe(0);
      expect(harness.stderr()).toContain("--revision");
      expect(harness.stdout()).toBe("");
      expect(harness.revertGatewayDataDirectory()).toBeUndefined();
      expect(harness.commitRevertedInvoice).not.toHaveBeenCalled();
    },
  );

  it("入金完了日とリビジョン不一致を列挙し元の請求書を維持する", async () => {
    const harness = await createRevertToDraftHarness();
    harness.savedInvoice()!.paymentCompletedDate = "2026-10-24";
    const before = structuredClone(harness.savedInvoice());
    const exitCode = await runCli(
      [
        "node",
        "keiri",
        "invoice",
        "revert-to-draft",
        "ACME-202610-01",
        "--revision",
        "1",
      ],
      harness.dependencies,
      harness.io,
    );
    expect(exitCode).toBe(1);
    expect(harness.stderr()).toContain("paymentCompletedDate");
    expect(harness.stderr()).toContain("revision");
    expect(harness.stdout()).toBe("");
    expect(harness.savedInvoice()).toEqual(before);
    expect(harness.commitRevertedInvoice).not.toHaveBeenCalled();
  });

  it("PDF破棄の失敗理由を標準エラーへ出力する", async () => {
    const harness = await createRevertToDraftHarness();
    harness.commitRevertedInvoice.mockRejectedValueOnce(
      new Error("PDFを破棄できません。"),
    );
    const before = structuredClone(harness.savedInvoice());
    const exitCode = await runCli(
      [
        "node",
        "keiri",
        "invoice",
        "revert-to-draft",
        "ACME-202610-01",
        "--revision",
        "2",
      ],
      harness.dependencies,
      harness.io,
    );
    expect(exitCode).toBe(1);
    expect(harness.stderr()).toContain("PDFを破棄できません。");
    expect(harness.stdout()).toBe("");
    expect(harness.savedInvoice()).toEqual(before);
  });
});
