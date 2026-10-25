import { describe, expect, it, vi } from "vitest";

import type { Invoice } from "#lib/domain/model";
import {
  createInvoiceForPartner,
  createPartner,
} from "#lib/testing/business-partners";
import { createInvoiceDraftFormContent } from "#lib/testing/invoice-draft-form";
import { createReadData } from "#lib/testing/keiri-read-data";
import {
  createInvoiceDraft,
  type InvoiceCreationGateway,
} from "./create-invoice-draft";
import { duplicateInvoiceDraft } from "./duplicate-invoice-draft";

function createHarness() {
  const context = createReadData();
  context.invoices = [];
  const loadCreationContext = vi.fn(async () => context);
  const saveNewInvoice = vi.fn<InvoiceCreationGateway["saveNewInvoice"]>(
    async (invoice) => ({
      filePath: `sales/invoices/${invoice.transactionDate.slice(0, 4)}/${invoice.invoiceNumber}.yaml`,
    }),
  );
  return {
    context,
    gateway: { loadCreationContext, saveNewInvoice },
    saveNewInvoice,
    loadCreationContext,
  };
}

const creationInput = {
  businessPartnerCode: "ACME",
  paymentDueDate: "2026-11-30",
  issueDate: "2026-10-25",
  today: "2026-10-26",
};

describe("請求書全体フォームの初回保存", () => {
  it("明細などの全入力を検証して1回で保存し、取引年を保存先に使う", async () => {
    const harness = createHarness();
    const content = createInvoiceDraftFormContent({
      transactionDate: "2025-12-31",
      honorific: "様",
      unitPricesIncludeTax: true,
      bankAccountIds: ["secondary", "primary"],
      notes: "最初の保存から含む備考",
      pdfFileNameOverride: "個別の請求書名",
    });
    const before = structuredClone({ context: harness.context, content });
    const result = await createInvoiceDraft(harness.gateway, {
      ...creationInput,
      content,
    });
    expect(result.filePath).toBe("sales/invoices/2025/ACME-202610-01.yaml");
    expect(result.invoice).toMatchObject({
      revision: 1,
      status: "draft",
      invoiceNumber: "ACME-202610-01",
      issueDate: "2026-10-25",
      transactionDate: "2025-12-31",
      paymentDueDate: "2026-11-30",
      paymentCompletedDate: null,
      unitPricesIncludeTax: true,
      businessPartner: {
        code: "ACME",
        snapshot: { addressee: "株式会社サンプル", honorific: "様" },
      },
      lineItems: content.lineItems,
      notes: content.notes,
      pdf: {
        fileNameOverride: content.pdfFileNameOverride,
        issuedFileName: null,
      },
    });
    expect(
      result.invoice.issuer.snapshot.bankAccounts.map((account) => account.id),
    ).toEqual(["secondary", "primary"]);
    expect(harness.loadCreationContext).toHaveBeenCalledOnce();
    expect(harness.saveNewInvoice).toHaveBeenCalledExactlyOnceWith(
      result.invoice,
    );
    expect({ context: harness.context, content }).toEqual(before);
    expect(result.invoice.lineItems[0]).not.toBe(content.lineItems[0]);
  });

  it("保存時に選択した取引先と現在の発行者・設定からスナップショットを作る", async () => {
    const harness = createHarness();
    harness.context.businessPartners = [
      createPartner({
        code: "OTHER",
        addressee: "保存時の宛名",
        issuerDisplay: {
          phone: true,
          email: false,
          bankAccountIds: ["primary"],
        },
      }),
    ];
    harness.context.issuers[0].name = "保存時の発行者";
    harness.context.issuers[0].bankAccounts[1].bankName = "保存時の振込先銀行";
    harness.context.settings.rounding = {
      lineAmount: "halfUp",
      taxAmount: "ceil",
    };
    const result = await createInvoiceDraft(harness.gateway, {
      ...creationInput,
      businessPartnerCode: "OTHER",
      content: createInvoiceDraftFormContent({ bankAccountIds: ["secondary"] }),
    });
    expect(result.invoice).toMatchObject({
      invoiceNumber: "OTHER-202610-01",
      rounding: { lineAmount: "halfUp", taxAmount: "ceil" },
      businessPartner: { snapshot: { addressee: "保存時の宛名" } },
      issuer: {
        snapshot: {
          name: "保存時の発行者",
          phone: { visible: true, value: "03-1234-5678" },
          bankAccounts: [{ id: "secondary", bankName: "保存時の振込先銀行" }],
        },
      },
    });
  });

  it.each([
    {
      reason: "不正な取引日",
      content: createInvoiceDraftFormContent({ transactionDate: "2026-02-30" }),
      path: ["transactionDate"],
    },
    {
      reason: "未完成の明細",
      content: createInvoiceDraftFormContent({
        lineItems: [
          {
            name: "",
            unit: "",
            quantity: 1,
            unitPrice: 100,
            taxCategoryId: "standard-10",
          },
        ],
      }),
      path: ["lineItems", 0, "name"],
    },
    {
      reason: "不正な数量",
      content: createInvoiceDraftFormContent({
        lineItems: [
          {
            name: "業務",
            unit: "式",
            quantity: 0.001,
            unitPrice: 100,
            taxCategoryId: "standard-10",
          },
        ],
      }),
      path: ["lineItems", 0, "quantity"],
    },
    {
      reason: "不正な単価",
      content: createInvoiceDraftFormContent({
        lineItems: [
          {
            name: "業務",
            unit: "式",
            quantity: 1,
            unitPrice: 0,
            taxCategoryId: "standard-10",
          },
        ],
      }),
      path: ["lineItems", 0, "unitPrice"],
    },
    {
      reason: "不正な個別名",
      content: createInvoiceDraftFormContent({
        pdfFileNameOverride: "../請求書",
      }),
      path: ["pdf", "fileNameOverride"],
    },
    {
      reason: "存在しない振込先",
      content: createInvoiceDraftFormContent({ bankAccountIds: ["unknown"] }),
      path: ["content", "bankAccountIds", 0],
    },
    {
      reason: "重複した振込先",
      content: createInvoiceDraftFormContent({
        bankAccountIds: ["primary", "primary"],
      }),
      path: ["content", "bankAccountIds", 1],
    },
  ])(
    "$reason は全体を拒否し、空の下書きも保存しない",
    async ({ content, path }) => {
      const harness = createHarness();
      await expect(
        createInvoiceDraft(harness.gateway, { ...creationInput, content }),
      ).rejects.toMatchObject({
        issues: expect.arrayContaining([expect.objectContaining({ path })]),
      });
      expect(harness.saveNewInvoice).not.toHaveBeenCalled();
      expect(
        (
          await createInvoiceDraft(harness.gateway, {
            ...creationInput,
            content: createInvoiceDraftFormContent(),
          })
        ).invoice.invoiceNumber,
      ).toBe("ACME-202610-01");
    },
  );

  it.each([0, 11])(
    "明細%d件と振込先0件も下書きとして保存できる",
    async (count) => {
      const harness = createHarness();
      const lineItem = createInvoiceDraftFormContent().lineItems[0];
      const content = createInvoiceDraftFormContent({
        lineItems: Array.from({ length: count }, () => ({ ...lineItem })),
        bankAccountIds: [],
      });
      const result = await createInvoiceDraft(harness.gateway, {
        ...creationInput,
        paymentDueDate: "2026-09-30",
        content,
      });
      expect(result.invoice.lineItems).toHaveLength(count);
      expect(result.invoice.issuer.snapshot.bankAccounts).toEqual([]);
      expect(result.invoice.paymentDueDate).toBe("2026-09-30");
    },
  );

  it.each(["draft", "issued"] as const)(
    "%s の複製フォームで変更した内容を保存し、元データを変更しない",
    async (status) => {
      const harness = createHarness();
      const source: Invoice = {
        ...createInvoiceForPartner(createPartner(), status),
        notes: "元の備考",
        pdf: {
          fileNameOverride: "元の個別名",
          issuedFileName: status === "issued" ? "元の個別名.pdf" : null,
        },
      };
      harness.context.invoices = [source];
      harness.context.businessPartners = [
        createPartner(),
        createPartner({ code: "OTHER", addressee: "複製先の宛名" }),
      ];
      const content = createInvoiceDraftFormContent({
        transactionDate: "2027-01-01",
        lineItems: [
          { ...source.lineItems[0], name: "変更後の業務", quantity: 2 },
        ],
        notes: null,
        bankAccountIds: ["secondary"],
      });
      const before = structuredClone(harness.context);
      const result = await duplicateInvoiceDraft(harness.gateway, {
        sourceInvoiceNumber: source.invoiceNumber,
        ...creationInput,
        businessPartnerCode: "OTHER",
        content,
      });
      expect(result.invoice).toMatchObject({
        invoiceNumber: "OTHER-202610-01",
        revision: 1,
        transactionDate: "2027-01-01",
        lineItems: content.lineItems,
        notes: null,
        unitPricesIncludeTax: false,
        pdf: { fileNameOverride: null, issuedFileName: null },
        businessPartner: { snapshot: { addressee: "複製先の宛名" } },
      });
      expect(harness.saveNewInvoice).toHaveBeenCalledOnce();
      expect(harness.context).toEqual(before);
    },
  );

  it("新規は現在の標準税率、複製は元の税区分を使い、フォームから差し替えない", async () => {
    const harness = createHarness();
    harness.context.taxCategories[0].deprecated = true;
    harness.context.taxCategories = [
      ...harness.context.taxCategories,
      {
        id: "standard-20",
        name: "新標準",
        treatment: "taxable",
        deprecated: false,
        isStandardRate: true,
        ratePercent: 20,
      },
    ];
    const source = createInvoiceForPartner();
    harness.context.invoices = [source];
    const content = createInvoiceDraftFormContent();
    await expect(
      createInvoiceDraft(harness.gateway, { ...creationInput, content }),
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({ path: ["lineItems", 0, "taxCategoryId"] }),
      ],
    });
    expect(harness.saveNewInvoice).not.toHaveBeenCalled();
    const duplicated = await duplicateInvoiceDraft(harness.gateway, {
      sourceInvoiceNumber: source.invoiceNumber,
      ...creationInput,
      content,
    });
    expect(duplicated.invoice.lineItems[0].taxCategoryId).toBe("standard-10");
    const changed = createInvoiceDraftFormContent({
      lineItems: [{ ...content.lineItems[0], taxCategoryId: "standard-20" }],
    });
    await expect(
      duplicateInvoiceDraft(harness.gateway, {
        sourceInvoiceNumber: source.invoiceNumber,
        ...creationInput,
        content: changed,
      }),
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({ path: ["lineItems", 0, "taxCategoryId"] }),
      ],
    });
    expect(
      (
        await createInvoiceDraft(harness.gateway, {
          ...creationInput,
          content: changed,
        })
      ).invoice.lineItems[0].taxCategoryId,
    ).toBe("standard-20");
  });
});
