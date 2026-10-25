import { describe, expect, it } from "vitest";

import type {
  InvoiceCreationContext,
  InvoiceCreationGateway,
} from "../application/create-invoice-draft";
import { handleCreateInvoiceRequest } from "./invoice-api";

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

function createGateway() {
  let saveCount = 0;
  const gateway: InvoiceCreationGateway = {
    async loadCreationContext() {
      return createContext();
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
