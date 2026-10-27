import { describe, expect, it, vi } from "vitest";

import type { InvoicePaymentGateway } from "#lib/application/manage-invoice-payment";
import type { Invoice } from "#lib/domain/model";
import { KeiriDataLoadError } from "#lib/server/keiri-data-loader";
import {
  handleDeleteInvoicePaymentCompletedDateRequest,
  handleSetInvoicePaymentCompletedDateRequest,
} from "./invoice-payment-api";

const url = new URL(
  "http://127.0.0.1:5173/api/invoices/ACME-202610-01/payment-completed-date",
);

function createHarness() {
  const invoice: Invoice = {
    revision: 1,
    status: "issued",
    invoiceNumber: "ACME-202610-01",
    businessPartner: {
      code: "ACME",
      snapshot: { addressee: "株式会社サンプル", honorific: "御中" },
    },
    issuer: {
      id: "issuer",
      snapshot: {
        name: "発行者",
        registrationNumber: "T0000000000000",
        phone: { visible: false },
        email: { visible: false },
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
      },
    },
    invoiceDate: "2026-10-20",
    paymentDueDate: "2026-11-30",
    paymentCompletedDate: null,
    unitPricesIncludeTax: false,
    lineItems: [
      {
        name: "開発業務",
        quantity: 1,
        unit: "式",
        unitPrice: 10_000,
        taxCategoryId: "standard-10",
      },
    ],
    notes: "請求内容は変更しない",
    rounding: { lineAmount: "floor", taxAmount: "floor" },
    pdf: { fileNameOverride: null, issuedFileName: "ACME-202610-01.pdf" },
  };
  const loadInvoice = vi.fn<InvoicePaymentGateway["loadInvoice"]>(
    async () => invoice,
  );
  const saveInvoicePayment = vi.fn<InvoicePaymentGateway["saveInvoicePayment"]>(
    async () => ({ filePath: "sales/invoices/2026/ACME-202610-01.yaml" }),
  );
  return {
    invoice,
    loadInvoice,
    saveInvoicePayment,
    dependencies: {
      gateway: { loadInvoice, saveInvoicePayment },
      today: "2026-10-25",
    },
  };
}

function createRequest(
  method: string,
  body: string,
  origin: string | null = url.origin,
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (origin !== null) {
    headers.origin = origin;
  }
  return new Request(url, { method, headers, body });
}

function handle(
  method: string,
  harness: ReturnType<typeof createHarness>,
  body?: string,
  origin: string | null = url.origin,
) {
  const source =
    body ??
    (method === "PUT"
      ? '{"revision":1,"paymentCompletedDate":"2026-10-25"}'
      : '{"revision":1}');
  const handler =
    method === "PUT"
      ? handleSetInvoicePaymentCompletedDateRequest
      : handleDeleteInvoicePaymentCompletedDateRequest;
  return handler(
    createRequest(method, source, origin),
    url,
    harness.invoice.invoiceNumber,
    harness.dependencies,
  );
}

describe("入金管理API", () => {
  it.each([null, "2026-10-24"])(
    "PUTで入金完了日 %s を記録・更新し、更新後の請求書を返す",
    async (previous) => {
      const harness = createHarness();
      harness.invoice.paymentCompletedDate = previous;
      const original = structuredClone(harness.invoice);
      const response = await handle("PUT", harness);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        invoice: {
          ...original,
          revision: 2,
          paymentCompletedDate: "2026-10-25",
        },
        filePath: "sales/invoices/2026/ACME-202610-01.yaml",
      });
      expect(harness.loadInvoice).toHaveBeenCalledWith("ACME-202610-01");
      expect(harness.saveInvoicePayment).toHaveBeenCalledOnce();
      expect(harness.invoice).toEqual(original);
    },
  );

  it("DELETEで入金完了日を削除し、請求内容と発行済み状態を維持する", async () => {
    const harness = createHarness();
    harness.invoice.paymentCompletedDate = "2026-10-24";
    const original = structuredClone(harness.invoice);
    const response = await handle("DELETE", harness);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      invoice: { ...original, revision: 2, paymentCompletedDate: null },
      filePath: "sales/invoices/2026/ACME-202610-01.yaml",
    });
    expect(harness.saveInvoicePayment).toHaveBeenCalledOnce();
    expect(harness.invoice).toEqual(original);
  });

  it.each([
    { method: "PUT", origin: "https://example.com" },
    { method: "PUT", origin: null },
    { method: "DELETE", origin: "https://example.com" },
    { method: "DELETE", origin: null },
  ])(
    "$method の外部・未指定Origin $origin を読み込み前に拒否する",
    async ({ method, origin }) => {
      const harness = createHarness();
      const response = await handle(method, harness, undefined, origin);
      expect(response.status).toBe(403);
      expect(harness.loadInvoice).not.toHaveBeenCalled();
      expect(harness.saveInvoicePayment).not.toHaveBeenCalled();
    },
  );

  it.each([
    { method: "PUT", body: "{" },
    { method: "PUT", body: '{"revision":1}' },
    { method: "PUT", body: '{"revision":1,"paymentCompletedDate":null}' },
    { method: "PUT", body: '{"revision":1,"paymentCompletedDate":""}' },
    {
      method: "PUT",
      body: '{"revision":0,"paymentCompletedDate":"2026-10-25"}',
    },
    {
      method: "PUT",
      body: '{"revision":1,"paymentCompletedDate":"2026-10-25","notes":"上書き"}',
    },
    { method: "DELETE", body: "{" },
    { method: "DELETE", body: "{}" },
    { method: "DELETE", body: '{"revision":"1"}' },
    { method: "DELETE", body: '{"revision":1,"paymentCompletedDate":null}' },
  ])(
    "$method の本文の不正・追加項目を400で拒否する: $body",
    async ({ method, body }) => {
      const harness = createHarness();
      const response = await handle(method, harness, body);
      expect(response.status).toBe(400);
      expect(harness.loadInvoice).not.toHaveBeenCalled();
      expect(harness.saveInvoicePayment).not.toHaveBeenCalled();
    },
  );

  it.each(["2026-10-26", "2026-02-29"])(
    "未来日・不正日付 %s を422で拒否する",
    async (date) => {
      const harness = createHarness();
      const response = await handle(
        "PUT",
        harness,
        JSON.stringify({ revision: 1, paymentCompletedDate: date }),
      );
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        issues: [expect.objectContaining({ path: ["paymentCompletedDate"] })],
      });
      expect(harness.saveInvoicePayment).not.toHaveBeenCalled();
    },
  );

  it.each(["PUT", "DELETE"])(
    "%s で下書き状態とリビジョン不一致を422で返す",
    async (method) => {
      const harness = createHarness();
      harness.invoice.status = "draft";
      harness.invoice.revision = 2;
      harness.invoice.pdf.issuedFileName = null;
      const response = await handle(method, harness);
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ["status"] }),
          expect.objectContaining({ path: ["revision"] }),
        ]),
      });
      expect(harness.saveInvoicePayment).not.toHaveBeenCalled();
    },
  );

  it.each(["PUT", "DELETE"])("%s の対象がなければ422で返す", async (method) => {
    const harness = createHarness();
    harness.loadInvoice.mockResolvedValueOnce(undefined);
    const response = await handle(method, harness);
    expect(response.status).toBe(422);
    expect(harness.saveInvoicePayment).not.toHaveBeenCalled();
  });

  it("データ読み込みの問題を対象パスと理由付きの500で返す", async () => {
    const harness = createHarness();
    const issues = [
      {
        filePath: "issuers/issuer.yaml",
        path: ["registrationNumber"],
        message: "登録番号が不正です。",
      },
    ];
    harness.loadInvoice.mockRejectedValueOnce(new KeiriDataLoadError(issues));
    const response = await handle("PUT", harness);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ issues });
    expect(harness.saveInvoicePayment).not.toHaveBeenCalled();
  });
});
