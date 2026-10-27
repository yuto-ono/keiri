import { describe, expect, it, vi } from "vitest";
import { getInvoiceCreationData } from "#lib/application/read-keiri-data";
import { createReadData } from "#lib/testing/keiri-read-data";
import { createPartner } from "#lib/testing/business-partners";
import {
  changeUnsavedInvoicePartner,
  createUnsavedInvoiceForm,
  getUnsavedInvoiceFieldContext,
  getUnsavedIssuerSnapshot,
  prepareUnsavedInvoice,
  previewUnsavedInvoice,
  saveUnsavedInvoice,
  type InvoiceCreationScreenData,
} from "./invoice-creation";

async function screen(duplicate = false): Promise<InvoiceCreationScreenData> {
  const data = createReadData();
  data.businessPartners = [
    createPartner(),
    createPartner({
      code: "OTHER",
      addressee: "別の取引先",
      honorific: "様",
      unitPricesIncludeTax: true,
      issuerDisplay: {
        phone: true,
        email: false,
        bankAccountIds: ["secondary", "primary"],
      },
    }),
  ];
  data.invoices[0].notes = "複製する備考";
  data.invoices[0].unitPricesIncludeTax = true;
  data.invoices[0].pdf.fileNameOverride = "複製しない個別名";
  const context = await getInvoiceCreationData(
    { loadData: async () => data, readIssuedPdf: vi.fn() },
    duplicate ? data.invoices[0].invoiceNumber : undefined,
  );
  return { ...context!, today: "2026-01-01" };
}

describe("新規作成・複製の未保存フォーム", () => {
  it("取引先を自動選択せず、請求日を初期化し、支払期限は空欄にする", async () => {
    const context = await screen();
    const form = createUnsavedInvoiceForm(context);
    expect(form).toMatchObject({
      businessPartnerCode: "",
      invoiceDate: "2026-01-01",
      paymentDueDate: "",
      honorific: "",
      bankAccountIds: [],
      lineItems: [],
      notes: "",
      pdfFileNameOverride: "",
    });
    expect(form).not.toHaveProperty("invoiceNumber");
    expect(form).not.toHaveProperty("revision");
    expect(getUnsavedInvoiceFieldContext(form, context)).toMatchObject({
      invoiceMonth: null,
      businessPartnerCode: "",
      taxCategory: { ok: true, value: { id: "standard-10" } },
    });
  });
  it("取引先の選び直しで依存する初期値を更新し、明細・日付・備考は保持する", async () => {
    const context = await screen(true);
    const initial = createUnsavedInvoiceForm(context);
    initial.paymentDueDate = "2026-02-28";
    initial.invoiceDate = "2026-02-01";
    initial.pdfFileNameOverride = "入力した個別名";
    const form = changeUnsavedInvoicePartner(initial, "OTHER", context);
    expect(form).toMatchObject({
      businessPartnerCode: "OTHER",
      honorific: "様",
      unitPricesIncludeTax: true,
      bankAccountIds: ["secondary", "primary"],
      invoiceDate: "2026-02-01",
      paymentDueDate: "2026-02-28",
      notes: "複製する備考",
      pdfFileNameOverride: "入力した個別名",
    });
    expect(form.lineItems).toEqual(initial.lineItems);
    expect(getUnsavedIssuerSnapshot(form, context)).toMatchObject({
      phone: { visible: true, value: context.issuer.phone },
      name: context.issuer.name,
    });
    expect(getUnsavedInvoiceFieldContext(form, context).addressee).toBe(
      "別の取引先",
    );
  });
  it("複製は明細と備考だけを引き継ぎ、宛名などの初期値には現在の取引先を使う", async () => {
    const context = await screen(true);
    context.businessPartners[0].honorific = "様";
    const before = structuredClone(context);
    const form = createUnsavedInvoiceForm(context);
    expect(form).toMatchObject({
      businessPartnerCode: "ACME",
      honorific: "様",
      unitPricesIncludeTax: false,
      invoiceDate: context.today,
      paymentDueDate: "",
      notes: "複製する備考",
      pdfFileNameOverride: "",
    });
    expect(form.lineItems[0]).not.toBe(context.source!.lineItems[0]);
    form.lineItems[0].name = "編集後";
    expect(context).toEqual(before);
  });
  it("支払期限の入力前も明細金額と税額を計算できる", async () => {
    const context = await screen(true);
    const form = createUnsavedInvoiceForm(context);
    expect(previewUnsavedInvoice(form, context)).toMatchObject({
      ok: true,
      value: { totalAmount: "11000" },
    });
    expect(prepareUnsavedInvoice(form, context).ok).toBe(false);
  });
  it.each([false, true])(
    "保存時に全体を専用APIへ1回送信する（複製=%s）",
    async (duplicate) => {
      const context = await screen(duplicate);
      let form = createUnsavedInvoiceForm(context);
      form = changeUnsavedInvoicePartner(form, "OTHER", context);
      form.invoiceDate = "2026-02-01";
      form.paymentDueDate = "2026-02-28";
      form.lineItems = [
        { name: "業務", quantity: 2.5, unit: "時間", unitPrice: 10000 },
      ];
      form.notes = "変更後の備考";
      form.pdfFileNameOverride = "個別名";
      const before = structuredClone({ form, context });
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ invoice: { invoiceNumber: "OTHER-202602-01" } }),
        );
      expect((await saveUnsavedInvoice(fetcher, form, context)).ok).toBe(true);
      expect(fetcher).toHaveBeenCalledOnce();
      const [url, init] = fetcher.mock.calls[0];
      expect(url).toBe(
        duplicate
          ? `/api/invoices/${context.source!.invoiceNumber}/duplicate`
          : "/api/invoices",
      );
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toEqual({
        businessPartnerCode: "OTHER",
        invoiceDate: "2026-02-01",
        paymentDueDate: "2026-02-28",
        content: {
          honorific: "様",
          unitPricesIncludeTax: true,
          bankAccountIds: ["secondary", "primary"],
          lineItems: [{ ...form.lineItems[0], taxCategoryId: "standard-10" }],
          notes: "変更後の備考",
          pdfFileNameOverride: "個別名",
        },
      });
      expect({ form, context }).toEqual(before);
    },
  );
  it("不正な入力は全体を拒否し、未完成の明細を捨てない", async () => {
    const context = await screen();
    const form = createUnsavedInvoiceForm(context);
    form.lineItems.push({
      name: "",
      quantity: undefined,
      unit: "",
      unitPrice: undefined,
    });
    const before = structuredClone(form);
    const fetcher = vi.fn<typeof fetch>();
    const result = await saveUnsavedInvoice(fetcher, form, context);
    expect(result).toMatchObject({
      ok: false,
      error: {
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ["businessPartnerCode"] }),
          expect.objectContaining({ path: ["paymentDueDate"] }),
          expect.objectContaining({ path: ["lineItems", 0, "quantity"] }),
        ]),
      },
    });
    expect(form).toEqual(before);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("保存失敗時に入力を保持し、自動で再送しない", async () => {
    const context = await screen(true);
    const form = createUnsavedInvoiceForm(context);
    form.paymentDueDate = "2026-02-28";
    const before = structuredClone(form);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { message: "作成できません。", issues: [] },
          { status: 422 },
        ),
      );
    expect((await saveUnsavedInvoice(fetcher, form, context)).ok).toBe(false);
    expect(form).toEqual(before);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
