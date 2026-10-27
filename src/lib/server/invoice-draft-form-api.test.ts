import { describe, expect, it, vi } from "vitest";

import type { InvoiceCreationGateway } from "#lib/application/create-invoice-draft";
import {
  createInvoiceForPartner,
  createPartner,
} from "#lib/testing/business-partners";
import { createInvoiceDraftFormContent } from "#lib/testing/invoice-draft-form";
import { createReadData } from "#lib/testing/keiri-read-data";
import {
  handleCreateInvoiceRequest,
  handleDuplicateInvoiceRequest,
} from "./invoice-api";

function createHarness() {
  const context = createReadData();
  context.businessPartners = [
    createPartner(),
    createPartner({ code: "OTHER", addressee: "新しい取引先" }),
  ];
  const source = { ...createInvoiceForPartner(), notes: "複製元の備考" };
  context.invoices = [source];
  const loadCreationContext = vi.fn(async () => context);
  const saveNewInvoice = vi.fn<InvoiceCreationGateway["saveNewInvoice"]>(
    async (invoice) => ({
      filePath: `sales/invoices/${invoice.invoiceDate.slice(0, 4)}/${invoice.invoiceNumber}.yaml`,
    }),
  );
  return {
    context,
    source,
    loadCreationContext,
    saveNewInvoice,
    dependencies: {
      gateway: { loadCreationContext, saveNewInvoice },
      today: "2026-10-26",
    },
  };
}

function formBody() {
  return {
    businessPartnerCode: "OTHER",
    invoiceDate: "2026-12-01",
    paymentDueDate: "2027-01-31",
    content: createInvoiceDraftFormContent({
      honorific: "様",
      unitPricesIncludeTax: true,
      bankAccountIds: ["secondary", "primary"],
      notes: null,
      pdfFileNameOverride: "入力した個別名",
    }),
  };
}

const operations = [
  {
    name: "新規作成",
    run: (
      request: Request,
      dependencies: ReturnType<typeof createHarness>["dependencies"],
    ) =>
      handleCreateInvoiceRequest(request, new URL(request.url), dependencies),
  },
  {
    name: "複製",
    run: (
      request: Request,
      dependencies: ReturnType<typeof createHarness>["dependencies"],
    ) =>
      handleDuplicateInvoiceRequest(
        request,
        new URL(request.url),
        "ACME-202610-01",
        dependencies,
      ),
  },
];

function requestFor(
  body: unknown,
  origin: string | null = "http://127.0.0.1:5173",
) {
  return new Request("http://127.0.0.1:5173/api/invoices", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin === null ? {} : { origin }),
    },
    body: JSON.stringify(body),
  });
}

describe.each(operations)("$name の全体フォームAPI", ({ run }) => {
  it("変更した取引先・請求年月・明細などをまとめてリビジョン1で保存する", async () => {
    const harness = createHarness();
    const body = formBody();
    body.content.lineItems[0].name = "フォームで編集した業務";
    body.content.lineItems[0].quantity = 1.25;
    const before = structuredClone(harness.context);
    const response = await run(requestFor(body), harness.dependencies);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      filePath: "sales/invoices/2026/OTHER-202612-01.yaml",
      invoice: {
        revision: 1,
        status: "draft",
        invoiceNumber: "OTHER-202612-01",
        invoiceDate: "2026-12-01",
        paymentDueDate: "2027-01-31",
        paymentCompletedDate: null,
        businessPartner: {
          code: "OTHER",
          snapshot: { addressee: "新しい取引先", honorific: "様" },
        },
        unitPricesIncludeTax: true,
        lineItems: body.content.lineItems,
        notes: null,
        issuer: {
          snapshot: { bankAccounts: [{ id: "secondary" }, { id: "primary" }] },
        },
        pdf: { fileNameOverride: "入力した個別名", issuedFileName: null },
      },
    });
    expect(harness.loadCreationContext).toHaveBeenCalledOnce();
    expect(harness.saveNewInvoice).toHaveBeenCalledOnce();
    expect(harness.context).toEqual(before);
  });

  it.each([
    {
      field: "contentなし",
      mutate: (body: Record<string, unknown>) => {
        delete body.content;
      },
    },
    {
      field: "invoiceDateなし",
      mutate: (body: Record<string, unknown>) => {
        delete body.invoiceDate;
      },
    },
    {
      field: "明細なし",
      mutate: (body: Record<string, unknown>) => {
        delete (body.content as Record<string, unknown>).lineItems;
      },
    },
    {
      field: "備考なし",
      mutate: (body: Record<string, unknown>) => {
        delete (body.content as Record<string, unknown>).notes;
      },
    },
    {
      field: "リビジョンの指定",
      mutate: (body: Record<string, unknown>) => {
        body.revision = 3;
      },
    },
    {
      field: "状態の指定",
      mutate: (body: Record<string, unknown>) => {
        body.status = "issued";
      },
    },
    {
      field: "スナップショットの指定",
      mutate: (body: Record<string, unknown>) => {
        body.issuer = { snapshot: { name: "任意の発行者" } };
      },
    },
    {
      field: "端数処理の指定",
      mutate: (body: Record<string, unknown>) => {
        (body.content as Record<string, unknown>).rounding = {
          lineAmount: "ceil",
          taxAmount: "ceil",
        };
      },
    },
    {
      field: "不正な敬称",
      mutate: (body: Record<string, unknown>) => {
        (body.content as Record<string, unknown>).honorific = "殿";
      },
    },
    {
      field: "未完成の明細",
      mutate: (body: Record<string, unknown>) => {
        (body.content as Record<string, unknown>).lineItems = [
          {
            name: "",
            quantity: 1,
            unitPrice: 100,
            taxCategoryId: "standard-10",
          },
        ];
      },
    },
    {
      field: "不正な数量",
      mutate: (body: Record<string, unknown>) => {
        (body.content as Record<string, unknown>).lineItems = [
          {
            name: "業務",
            quantity: 1.001,
            unit: "式",
            unitPrice: 100,
            taxCategoryId: "standard-10",
          },
        ];
      },
    },
  ])("$field は400で拒否し、コンテキストを読み込まない", async ({ mutate }) => {
    const harness = createHarness();
    const body = formBody();
    mutate(body);
    const response = await run(requestFor(body), harness.dependencies);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      issues: expect.any(Array),
    });
    expect(harness.loadCreationContext).not.toHaveBeenCalled();
    expect(harness.saveNewInvoice).not.toHaveBeenCalled();
  });

  it("税区分や個別名などの不備をまとめて422で返し、全体を保存しない", async () => {
    const harness = createHarness();
    const body = formBody();
    body.content.lineItems[0].taxCategoryId = "unknown";
    body.content.pdfFileNameOverride = "不正/個別名";
    const response = await run(requestFor(body), harness.dependencies);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["lineItems", 0, "taxCategoryId"] }),
        expect.objectContaining({ path: ["pdf", "fileNameOverride"] }),
      ]),
    });
    expect(harness.saveNewInvoice).not.toHaveBeenCalled();
  });

  it.each([null, "https://example.com"])(
    "Origin %s からは受け付けない",
    async (origin) => {
      const harness = createHarness();
      const response = await run(
        requestFor(formBody(), origin),
        harness.dependencies,
      );
      expect(response.status).toBe(403);
      expect(harness.loadCreationContext).not.toHaveBeenCalled();
    },
  );

  it("壊れたJSONを400で返す", async () => {
    const harness = createHarness();
    const request = new Request("http://127.0.0.1:5173/api/invoices", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:5173" },
      body: "{",
    });
    expect((await run(request, harness.dependencies)).status).toBe(400);
    expect(harness.loadCreationContext).not.toHaveBeenCalled();
  });
});
