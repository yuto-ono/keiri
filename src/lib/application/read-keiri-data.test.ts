import { describe, expect, it, vi } from "vitest";

import {
  createInvoiceForPartner,
  createPartner,
} from "#lib/testing/business-partners";
import { createReadData } from "#lib/testing/keiri-read-data";
import {
  getBusinessPartner,
  getInvoice,
  getInvoicePdf,
  getIssuer,
  getSettings,
  listBusinessPartners,
  listInvoices,
  listIssuers,
  type KeiriReadGateway,
} from "./read-keiri-data";

function createHarness() {
  const data = createReadData();
  const loadData = vi.fn<KeiriReadGateway["loadData"]>(async () => data);
  const readIssuedPdf = vi.fn<KeiriReadGateway["readIssuedPdf"]>(
    async () => new Uint8Array([0, 255, 42]),
  );
  return {
    data,
    loadData,
    readIssuedPdf,
    gateway: { loadData, readIssuedPdf },
  };
}

describe("画面向けのデータ取得", () => {
  it("取引年を選び、月と取引日の新しい順で全件を返し、元のデータを並べ替えない", async () => {
    const harness = createHarness();
    harness.data.invoices = [
      "2025-12-31",
      "2026-10-12",
      "2026-02-03",
      "2026-10-25",
      "2027-01-01",
    ].map((date, index) => ({
      ...createInvoiceForPartner(),
      invoiceNumber: `ACME-202610-0${index + 1}`,
      transactionDate: date,
    }));
    const before = structuredClone(harness.data);
    const result = await listInvoices(harness.gateway, { today: "2026-10-25" });
    expect(result.year).toBe("2026");
    expect(result.years).toEqual(["2027", "2026", "2025"]);
    expect(
      result.months.map((group) => [
        group.month,
        group.invoices.map((invoice) => invoice.invoiceNumber),
      ]),
    ).toEqual([
      ["2026-10", ["ACME-202610-04", "ACME-202610-02"]],
      ["2026-02", ["ACME-202610-03"]],
    ]);
    expect(harness.data).toEqual(before);
    const previous = await listInvoices(harness.gateway, {
      today: "2026-10-25",
      year: "2025",
    });
    expect(previous.months[0].invoices[0].invoiceNumber).toBe("ACME-202610-01");
  });

  it("一覧にはスナップショットの宛名・敬称、支払期限、合計、状態、入金日を返す", async () => {
    const harness = createHarness();
    const invoice = createInvoiceForPartner(
      createPartner({ addressee: "保存済み宛名", honorific: "様" }),
      "issued",
    );
    invoice.paymentCompletedDate = "2026-10-24";
    harness.data.invoices = [invoice];
    const result = await listInvoices(harness.gateway, { today: "2026-10-25" });
    expect(result.months[0].invoices[0]).toEqual({
      invoiceNumber: invoice.invoiceNumber,
      transactionDate: "2026-10-25",
      paymentDueDate: "2026-11-30",
      status: "issued",
      paymentCompletedDate: "2026-10-24",
      addresseeWithHonorific: "保存済み宛名様",
      totalAmount: "11000",
    });
  });

  it("請求書のない年は月見出しや小計を作らず空一覧にする", async () => {
    const harness = createHarness();
    harness.data.invoices = [];
    expect(
      await listInvoices(harness.gateway, { today: "2026-10-25" }),
    ).toEqual({ year: "2026", years: ["2026"], months: [] });
    expect(
      await listInvoices(harness.gateway, {
        today: "2026-10-25",
        year: "2024",
      }),
    ).toEqual({ year: "2024", years: ["2026", "2024"], months: [] });
  });

  it("詳細では請求書が参照する税区分を使い、現在の標準税率で置き換えない", async () => {
    const harness = createHarness();
    harness.data.taxCategories = [
      {
        id: "standard-10",
        name: "過去の標準税率",
        treatment: "taxable",
        deprecated: true,
        isStandardRate: true,
        ratePercent: 10,
      },
      {
        id: "standard-20",
        name: "現在の標準税率",
        treatment: "taxable",
        deprecated: false,
        isStandardRate: true,
        ratePercent: 20,
      },
    ];
    const result = await getInvoice(harness.gateway, "ACME-202610-01");
    expect(result).toMatchObject({
      invoice: harness.data.invoices[0],
      taxCategory: harness.data.taxCategories[0],
      calculation: {
        lineAmounts: ["10000"],
        taxableAmount: "10000",
        taxAmount: "1000",
        totalAmount: "11000",
      },
    });
  });

  it("明細0件は税区分を推測せず、各金額を0として返す", async () => {
    const harness = createHarness();
    harness.data.invoices = [{ ...createInvoiceForPartner(), lineItems: [] }];
    harness.data.taxCategories = [];
    const result = await getInvoice(harness.gateway, "ACME-202610-01");
    expect(result).toMatchObject({
      taxCategory: null,
      calculation: {
        lineAmounts: [],
        taxableAmount: "0",
        taxAmount: "0",
        totalAmount: "0",
      },
    });
    expect(
      (await listInvoices(harness.gateway, { today: "2026-10-25" })).months[0]
        .invoices[0].totalAmount,
    ).toBe("0");
  });

  it("詳細の編集候補には現在の振込先と税定義を渡し、保存済み情報を置き換えない", async () => {
    const harness = createHarness();
    harness.data.issuers[0].bankAccounts[0].bankName = "現在の銀行名";
    const result = await getInvoice(harness.gateway, "ACME-202610-01");
    expect(result?.editOptions.bankAccounts).toEqual(
      harness.data.issuers[0].bankAccounts,
    );
    expect(result?.editOptions.taxCategories).toEqual(
      harness.data.taxCategories,
    );
    expect(result?.invoice.issuer.snapshot.bankAccounts[0].bankName).toBe(
      "銀行1",
    );
  });

  it("参照した税区分がなければ他の区分へ読み替えない", async () => {
    const harness = createHarness();
    harness.data.taxCategories = [];
    await expect(
      getInvoice(harness.gateway, "ACME-202610-01"),
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({ path: ["lineItems", 0, "taxCategoryId"] }),
      ],
    });
  });

  it("取引先をコード順に返し、請求指示は詳細で取得できる", async () => {
    const harness = createHarness();
    harness.data.businessPartners = [
      createPartner({ code: "Z", billingInstructions: "Z社の請求指示" }),
      createPartner({ billingInstructions: "ACME社の請求指示" }),
    ];
    expect(await listBusinessPartners(harness.gateway)).toEqual({
      businessPartners: [
        {
          code: "ACME",
          addresseeWithHonorific: "株式会社サンプル御中",
          requiresMonthlyInvoice: true,
        },
        {
          code: "Z",
          addresseeWithHonorific: "株式会社サンプル御中",
          requiresMonthlyInvoice: true,
        },
      ],
    });
    expect(await getBusinessPartner(harness.gateway, "ACME")).toEqual({
      businessPartner: harness.data.businessPartners[1],
      hasInvoiceReferences: true,
    });
    expect(await getBusinessPartner(harness.gateway, "Z")).toMatchObject({
      hasInvoiceReferences: false,
    });
  });

  it("発行者と設定は保存済みリビジョンを含む全体を返す", async () => {
    const harness = createHarness();
    expect(await listIssuers(harness.gateway)).toEqual({
      issuers: harness.data.issuers,
    });
    expect(await getIssuer(harness.gateway, "issuer")).toEqual({
      issuer: harness.data.issuers[0],
    });
    expect(await getSettings(harness.gateway)).toEqual({
      settings: harness.data.settings,
    });
  });

  it("存在しない請求書・取引先・発行者を区別する", async () => {
    const harness = createHarness();
    expect(await getInvoice(harness.gateway, "MISSING")).toBeUndefined();
    expect(
      await getBusinessPartner(harness.gateway, "MISSING"),
    ).toBeUndefined();
    expect(await getIssuer(harness.gateway, "MISSING")).toBeUndefined();
  });

  it("正式PDFは現在の命名規則で再計算せず、記録済みの名前で取得する", async () => {
    const harness = createHarness();
    const invoice = createInvoiceForPartner(createPartner(), "issued");
    invoice.pdf.issuedFileName = "発行時の名前.pdf";
    harness.data.invoices = [invoice];
    const result = await getInvoicePdf(harness.gateway, invoice.invoiceNumber);
    expect(result).toEqual({
      fileName: "発行時の名前.pdf",
      contents: new Uint8Array([0, 255, 42]),
    });
    expect(harness.readIssuedPdf).toHaveBeenCalledWith(invoice);
  });

  it.each(["ACME-202610-01", "../../管理外.pdf"])(
    "下書き・存在しない対象 %s のPDFは読み込まない",
    async (invoiceNumber) => {
      const harness = createHarness();
      expect(
        await getInvoicePdf(harness.gateway, invoiceNumber),
      ).toBeUndefined();
      expect(harness.readIssuedPdf).not.toHaveBeenCalled();
    },
  );
});
