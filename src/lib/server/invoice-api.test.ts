import { describe, expect, it, vi } from "vitest";

import type {
  InvoiceCreationContext,
  InvoiceCreationGateway,
} from "../application/create-invoice-draft";
import type { InvoiceUpdateGateway } from "#lib/application/update-invoice-draft";
import type {
  InvoiceIssueGateway,
  InvoicePdfRenderer,
} from "#lib/application/issue-invoice";
import type { Invoice } from "#lib/domain/model";
import {
  handleCreateInvoiceRequest,
  handleDuplicateInvoiceRequest,
  handleIssueInvoiceRequest,
  handleUpdateInvoiceRequest,
} from "./invoice-api";

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
}

function createGateway(context = createContext()) {
  let saveCount = 0;
  const gateway: InvoiceCreationGateway = {
    async loadCreationContext() {
      return context;
    },
    async saveNewInvoice(invoice) {
      saveCount += 1;
      return {
        filePath: `sales/invoices/2026/${invoice.invoiceNumber}.yaml`,
      };
    },
  };
  return { gateway, getSaveCount: () => saveCount };
}

function createRequest(body: BodyInit, origin = "http://127.0.0.1:5173") {
  return new Request("http://127.0.0.1:5173/api/invoices", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body,
  });
}

describe("請求書作成API", () => {
  it("同一オリジンの入力から下書きを作成する", async () => {
    const { gateway, getSaveCount } = createGateway();
    const response = await handleCreateInvoiceRequest(
      createRequest(
        JSON.stringify({
          businessPartnerCode: "ACME",
          paymentDueDate: "2026-11-30",
        }),
      ),
      new URL("http://127.0.0.1:5173/api/invoices"),
      { gateway, today: "2026-10-25" },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      invoice: { invoiceNumber: "ACME-202610-01", revision: 1 },
      filePath: "sales/invoices/2026/ACME-202610-01.yaml",
    });
    expect(getSaveCount()).toBe(1);
  });

  it("外部オリジンを保存前に拒否する", async () => {
    const { gateway, getSaveCount } = createGateway();
    const response = await handleCreateInvoiceRequest(
      createRequest("{}", "https://example.com"),
      new URL("http://127.0.0.1:5173/api/invoices"),
      { gateway, today: "2026-10-25" },
    );
    expect(response.status).toBe(403);
    expect(getSaveCount()).toBe(0);
  });

  it("壊れたJSONと未知のキーを400で拒否する", async () => {
    const first = createGateway();
    const invalidJsonResponse = await handleCreateInvoiceRequest(
      createRequest("{"),
      new URL("http://127.0.0.1:5173/api/invoices"),
      { gateway: first.gateway, today: "2026-10-25" },
    );
    expect(invalidJsonResponse.status).toBe(400);

    const second = createGateway();
    const unknownKeyResponse = await handleCreateInvoiceRequest(
      createRequest(
        JSON.stringify({
          businessPartnerCode: "ACME",
          paymentDueDate: "2026-11-30",
          unknown: true,
        }),
      ),
      new URL("http://127.0.0.1:5173/api/invoices"),
      { gateway: second.gateway, today: "2026-10-25" },
    );
    expect(unknownKeyResponse.status).toBe(400);
    expect(second.getSaveCount()).toBe(0);
  });

  it("業務検証エラーを422で返す", async () => {
    const { gateway, getSaveCount } = createGateway();
    const response = await handleCreateInvoiceRequest(
      createRequest(
        JSON.stringify({
          businessPartnerCode: "MISSING",
          paymentDueDate: "2026-11-30",
        }),
      ),
      new URL("http://127.0.0.1:5173/api/invoices"),
      { gateway, today: "2026-10-25" },
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      issues: [
        {
          path: ["businessPartnerCode"],
          message: expect.stringContaining("MISSING"),
        },
      ],
    });
    expect(getSaveCount()).toBe(0);
  });
});

function createIssueHarness() {
  const context = createContext();
  const invoice = createInvoice();
  invoice.lineItems = [
    {
      name: "開発業務",
      quantity: 1,
      unit: "式",
      unitPrice: 10_000,
      taxCategoryId: "standard-10",
    },
  ];
  const loadIssueContext = vi.fn<InvoiceIssueGateway["loadIssueContext"]>(
    async () => ({
      invoice,
      businessPartner: context.businessPartners[0],
      taxCategories: context.taxCategories,
    }),
  );
  const commitIssuedInvoice = vi.fn<InvoiceIssueGateway["commitIssuedInvoice"]>(
    async () => ({
      invoiceFilePath: "sales/invoices/2026/ACME-202610-01.yaml",
      pdfFilePath: "documents/2026/sales/invoices/ACME/ACME-202610-01.pdf",
    }),
  );
  const renderSinglePagePdf = vi.fn<InvoicePdfRenderer["renderSinglePagePdf"]>(
    async () => new Uint8Array([1, 2, 3]),
  );
  return {
    invoice,
    loadIssueContext,
    commitIssuedInvoice,
    renderSinglePagePdf,
    dependencies: {
      gateway: { loadIssueContext, commitIssuedInvoice },
      renderer: { renderSinglePagePdf },
      today: "2026-10-25",
    },
  };
}

const issueUrl = new URL(
  "http://127.0.0.1:5173/api/invoices/ACME-202610-01/issue",
);

function createIssueRequest(
  body: string,
  origin: string | null = issueUrl.origin,
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (origin !== null) {
    headers.origin = origin;
  }
  return new Request(issueUrl, { method: "POST", headers, body });
}

describe("請求書発行API", () => {
  it("保存済み下書きと期待リビジョンから発行しPDF保存先を返す", async () => {
    const harness = createIssueHarness();
    const response = await handleIssueInvoiceRequest(
      createIssueRequest(JSON.stringify({ revision: 1 })),
      issueUrl,
      "ACME-202610-01",
      harness.dependencies,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      invoice: {
        revision: 2,
        status: "issued",
        pdf: { issuedFileName: "ACME-202610-01.pdf" },
      },
      invoiceFilePath: "sales/invoices/2026/ACME-202610-01.yaml",
      pdfFilePath: "documents/2026/sales/invoices/ACME/ACME-202610-01.pdf",
    });
    expect(harness.loadIssueContext).toHaveBeenCalledWith("ACME-202610-01");
    expect(harness.renderSinglePagePdf).toHaveBeenCalledOnce();
    expect(harness.commitIssuedInvoice).toHaveBeenCalledOnce();
  });

  it.each(["https://example.com", null])(
    "外部または未指定のOrigin %s を読み込み前に拒否する",
    async (origin) => {
      const harness = createIssueHarness();
      const response = await handleIssueInvoiceRequest(
        createIssueRequest(JSON.stringify({ revision: 1 }), origin),
        issueUrl,
        "ACME-202610-01",
        harness.dependencies,
      );

      expect(response.status).toBe(403);
      expect(harness.loadIssueContext).not.toHaveBeenCalled();
      expect(harness.renderSinglePagePdf).not.toHaveBeenCalled();
      expect(harness.commitIssuedInvoice).not.toHaveBeenCalled();
    },
  );

  it.each([
    "{",
    "null",
    "{}",
    '{"revision":"1"}',
    '{"revision":0}',
    '{"revision":1.5}',
    '{"revision":9007199254740992}',
    '{"revision":1,"notes":"未保存の変更"}',
    '{"revision":1,"status":"issued"}',
  ])("不正なJSON・リビジョン・追加項目を400で拒否する: %s", async (body) => {
    const harness = createIssueHarness();
    const response = await handleIssueInvoiceRequest(
      createIssueRequest(body),
      issueUrl,
      "ACME-202610-01",
      harness.dependencies,
    );

    expect(response.status).toBe(400);
    expect(harness.loadIssueContext).not.toHaveBeenCalled();
    expect(harness.renderSinglePagePdf).not.toHaveBeenCalled();
    expect(harness.commitIssuedInvoice).not.toHaveBeenCalled();
  });

  it("リビジョン不一致を422で返し発行しない", async () => {
    const harness = createIssueHarness();
    const before = structuredClone(harness.invoice);
    const response = await handleIssueInvoiceRequest(
      createIssueRequest(JSON.stringify({ revision: 2 })),
      issueUrl,
      "ACME-202610-01",
      harness.dependencies,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      issues: [
        expect.objectContaining({
          path: ["revision"],
          message: expect.stringContaining("一致しません"),
        }),
      ],
    });
    expect(harness.invoice).toEqual(before);
    expect(harness.renderSinglePagePdf).not.toHaveBeenCalled();
    expect(harness.commitIssuedInvoice).not.toHaveBeenCalled();
  });

  it("未来の発行日を現在日と照合して拒否する", async () => {
    const harness = createIssueHarness();
    harness.invoice.issueDate = "2026-10-26";
    const response = await handleIssueInvoiceRequest(
      createIssueRequest(JSON.stringify({ revision: 1 })),
      issueUrl,
      "ACME-202610-01",
      harness.dependencies,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      issues: [expect.objectContaining({ path: ["issueDate"] })],
    });
    expect(harness.renderSinglePagePdf).not.toHaveBeenCalled();
    expect(harness.commitIssuedInvoice).not.toHaveBeenCalled();
  });

  it("PDF生成失敗を成功として返さず状態を保存しない", async () => {
    const harness = createIssueHarness();
    const failure = new Error("フォントを読み込めません。");
    harness.renderSinglePagePdf.mockRejectedValueOnce(failure);
    await expect(
      handleIssueInvoiceRequest(
        createIssueRequest(JSON.stringify({ revision: 1 })),
        issueUrl,
        "ACME-202610-01",
        harness.dependencies,
      ),
    ).rejects.toBe(failure);

    expect(harness.invoice.status).toBe("draft");
    expect(harness.invoice.revision).toBe(1);
    expect(harness.commitIssuedInvoice).not.toHaveBeenCalled();
  });
});

function createInvoice(): Invoice {
  const context = createContext();
  const issuer = context.issuers[0];
  return {
    revision: 1,
    status: "draft",
    invoiceNumber: "ACME-202610-01",
    businessPartner: {
      code: "ACME",
      snapshot: { addressee: "株式会社サンプル", honorific: "御中" },
    },
    issuer: {
      id: issuer.id,
      snapshot: {
        name: issuer.name,
        registrationNumber: issuer.registrationNumber,
        phone: { visible: false },
        email: { visible: false },
        bankAccounts: issuer.bankAccounts,
      },
    },
    issueDate: "2026-10-25",
    transactionDate: "2026-10-25",
    paymentDueDate: "2026-11-30",
    paymentCompletedDate: null,
    unitPricesIncludeTax: false,
    lineItems: [],
    notes: null,
    rounding: { lineAmount: "floor", taxAmount: "floor" },
    pdf: { fileNameOverride: null, issuedFileName: null },
  };
}

function createUpdateGateway(current = createInvoice()) {
  let savedInvoice: Invoice | undefined;
  const context = createContext();
  const gateway: InvoiceUpdateGateway = {
    async loadUpdateContext() {
      return {
        invoice: current,
        issuer: context.issuers[0],
        taxCategories: context.taxCategories,
      };
    },
    async saveUpdatedInvoice(_current, updated) {
      savedInvoice = updated;
      return {
        filePath: `sales/invoices/2026/${updated.invoiceNumber}.yaml`,
      };
    },
  };
  return { gateway, savedInvoice: () => savedInvoice };
}

function createUpdateRequest(body: unknown, origin = "http://127.0.0.1:5173") {
  return new Request("http://127.0.0.1:5173/api/invoices/ACME-202610-01", {
    method: "PUT",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("請求書更新API", () => {
  it("同一オリジンの完全な請求書から下書きを更新する", async () => {
    const current = createInvoice();
    const proposed = { ...current, notes: "更新後" };
    const harness = createUpdateGateway(current);
    const response = await handleUpdateInvoiceRequest(
      createUpdateRequest(proposed),
      new URL("http://127.0.0.1:5173/api/invoices/ACME-202610-01"),
      current.invoiceNumber,
      { gateway: harness.gateway },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      invoice: { revision: 2, notes: "更新後" },
      filePath: "sales/invoices/2026/ACME-202610-01.yaml",
    });
    expect(harness.savedInvoice()?.revision).toBe(2);
  });

  it("外部オリジンを更新前に拒否する", async () => {
    const harness = createUpdateGateway();
    const response = await handleUpdateInvoiceRequest(
      createUpdateRequest(createInvoice(), "https://example.com"),
      new URL("http://127.0.0.1:5173/api/invoices/ACME-202610-01"),
      "ACME-202610-01",
      { gateway: harness.gateway },
    );
    expect(response.status).toBe(403);
    expect(harness.savedInvoice()).toBeUndefined();
  });

  it("構造が不完全な入力を400で拒否する", async () => {
    const harness = createUpdateGateway();
    const response = await handleUpdateInvoiceRequest(
      createUpdateRequest({ revision: 1 }),
      new URL("http://127.0.0.1:5173/api/invoices/ACME-202610-01"),
      "ACME-202610-01",
      { gateway: harness.gateway },
    );
    expect(response.status).toBe(400);
    expect(harness.savedInvoice()).toBeUndefined();
  });

  it("URLと入力内の請求書番号不一致を422で拒否する", async () => {
    const harness = createUpdateGateway();
    const response = await handleUpdateInvoiceRequest(
      createUpdateRequest(createInvoice()),
      new URL("http://127.0.0.1:5173/api/invoices/OTHER-202610-01"),
      "OTHER-202610-01",
      { gateway: harness.gateway },
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      issues: [
        expect.objectContaining({
          path: ["invoiceNumber"],
          message: expect.stringContaining("一致しません"),
        }),
      ],
    });
  });
});

describe("請求書複製API", () => {
  it("複製条件から独立した下書きを作成する", async () => {
    const source = {
      ...createInvoice(),
      notes: "引き継ぐ備考",
      lineItems: [
        {
          name: "業務",
          quantity: 1,
          unit: "式",
          unitPrice: 10_000,
          taxCategoryId: "standard-10",
        },
      ],
    };
    const context = createContext();
    context.invoices = [source];
    const harness = createGateway(context);
    const response = await handleDuplicateInvoiceRequest(
      createRequest(JSON.stringify({ paymentDueDate: "2026-12-31" })),
      new URL("http://127.0.0.1:5173/api/invoices/ACME-202610-01/duplicate"),
      source.invoiceNumber,
      { gateway: harness.gateway, today: "2026-10-26" },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      invoice: {
        status: "draft",
        invoiceNumber: "ACME-202610-02",
        issueDate: "2026-10-26",
        paymentDueDate: "2026-12-31",
        notes: "引き継ぐ備考",
        lineItems: source.lineItems,
      },
    });
    expect(harness.getSaveCount()).toBe(1);
  });

  it("存在しない複製元を422で拒否する", async () => {
    const harness = createGateway();
    const response = await handleDuplicateInvoiceRequest(
      createRequest(JSON.stringify({ paymentDueDate: "2026-12-31" })),
      new URL("http://127.0.0.1:5173/api/invoices/MISSING-202610-01/duplicate"),
      "MISSING-202610-01",
      { gateway: harness.gateway, today: "2026-10-26" },
    );
    expect(response.status).toBe(422);
    expect(harness.getSaveCount()).toBe(0);
  });
});
