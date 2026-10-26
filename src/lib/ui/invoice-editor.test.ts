import { describe, expect, it, vi } from "vitest";
import type { InvoiceUpdateGateway } from "#lib/application/update-invoice-draft";
import { handleUpdateInvoiceRequest } from "#lib/server/invoice-api";
import {
  createInvoiceForPartner,
  createIssuer,
  createPartner,
} from "#lib/testing/business-partners";
import { createReadData } from "#lib/testing/keiri-read-data";
import {
  createInvoiceDraftForm,
  deleteInvoicePayment,
  deleteSavedInvoice,
  getBankAccountChoices,
  getEditingTaxCategory,
  hasInvoiceDraftChanges,
  issueSavedInvoice,
  prepareInvoiceDraftUpdate,
  revertSavedInvoice,
  saveInvoiceDraftForm,
  saveInvoicePayment,
} from "./invoice-editor";

function createHarness() {
  const invoice = { ...createInvoiceForPartner(), revision: 4 };
  const options = {
    bankAccounts: createIssuer().bankAccounts,
    taxCategories: createReadData().taxCategories,
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ invoice: { ...invoice, revision: 5 } }));
  return { invoice, options, fetcher };
}

describe("請求書編集フォーム", () => {
  it("保存済みデータから独立したフォームを作り、内容を戻すと未保存ではなくなる", () => {
    const { invoice } = createHarness();
    const form = createInvoiceDraftForm(invoice);
    expect(hasInvoiceDraftChanges(invoice, form)).toBe(false);
    form.lineItems[0].quantity = undefined;
    expect(hasInvoiceDraftChanges(invoice, form)).toBe(true);
    form.lineItems[0].quantity = invoice.lineItems[0].quantity;
    expect(hasInvoiceDraftChanges(invoice, form)).toBe(false);
    form.notes = "変更";
    expect(invoice.notes).toBeNull();
    expect(hasInvoiceDraftChanges(invoice, form)).toBe(true);
  });

  it("保存内容全体を送信し、保護対象の情報と期待リビジョンを保持する", async () => {
    const { invoice, options, fetcher } = createHarness();
    const form = createInvoiceDraftForm(invoice);
    form.transactionDate = "2025-12-31";
    form.paymentDueDate = "2026-12-31";
    form.honorific = "様";
    form.notes = "備考\n\n段落";
    form.pdfFileNameOverride = "請求書の個別名";
    form.bankAccountIds = ["secondary", "primary"];
    form.lineItems.push({
      name: "追加の業務",
      quantity: 2.5,
      unit: "時間",
      unitPrice: 100,
    });
    const before = structuredClone({ invoice, form });
    const result = await saveInvoiceDraftForm(fetcher, invoice, form, options);
    expect(result.ok).toBe(true);
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe("/api/invoices/ACME-202610-01");
    expect(request?.method).toBe("PUT");
    const proposed = JSON.parse(request?.body as string);
    expect(proposed).toMatchObject({
      revision: 4,
      invoiceNumber: invoice.invoiceNumber,
      status: "draft",
      paymentCompletedDate: null,
      rounding: invoice.rounding,
      transactionDate: form.transactionDate,
      paymentDueDate: form.paymentDueDate,
      businessPartner: {
        code: "ACME",
        snapshot: {
          addressee: invoice.businessPartner.snapshot.addressee,
          honorific: "様",
        },
      },
      issuer: {
        snapshot: {
          name: invoice.issuer.snapshot.name,
          bankAccounts: [{ id: "secondary" }, { id: "primary" }],
        },
      },
      notes: form.notes,
      pdf: { fileNameOverride: form.pdfFileNameOverride, issuedFileName: null },
    });
    expect(proposed.lineItems).toHaveLength(2);
    expect(
      proposed.lineItems.map(
        (item: { taxCategoryId: string }) => item.taxCategoryId,
      ),
    ).toEqual(["standard-10", "standard-10"]);
    expect({ invoice, form }).toEqual(before);
    expect(hasInvoiceDraftChanges(invoice, form)).toBe(true);
  });

  it("現在の銀行情報が変わっていても既存スナップショットを保持し、追加分だけ現在値を使う", () => {
    const { invoice, options } = createHarness();
    options.bankAccounts[0].bankName = "変更後の銀行名";
    options.bankAccounts[1].bankName = "追加時の銀行名";
    const form = createInvoiceDraftForm(invoice);
    form.bankAccountIds = ["secondary", "primary"];
    const result = prepareInvoiceDraftUpdate(invoice, form, options);
    expect(
      result.ok &&
        result.value.invoice.issuer.snapshot.bankAccounts.map(
          (account) => account.bankName,
        ),
    ).toEqual([
      "追加時の銀行名",
      invoice.issuer.snapshot.bankAccounts[0].bankName,
    ]);
    expect(
      getBankAccountChoices(invoice, []).map((account) => account.id),
    ).toEqual(["primary"]);
  });

  it("保存済みの税区分を新しい標準税率へ置き換えず、新規明細にも同じ定義を使う", () => {
    const { invoice, options } = createHarness();
    options.taxCategories = [
      { ...options.taxCategories[0], deprecated: true },
      {
        id: "new-standard",
        name: "新標準",
        treatment: "taxable",
        deprecated: false,
        isStandardRate: true,
        ratePercent: 20,
      },
    ];
    const form = createInvoiceDraftForm(invoice);
    form.lineItems.push({ ...form.lineItems[0] });
    const result = prepareInvoiceDraftUpdate(invoice, form, options);
    expect(
      result.ok &&
        result.value.invoice.lineItems.map((item) => item.taxCategoryId),
    ).toEqual(["standard-10", "standard-10"]);
    expect(result.ok && result.value.calculation.totalAmount).toBe("22000");
  });

  it("明細0件の下書きには現在の標準税率を表示し、曖昧な場合は推測しない", () => {
    const { invoice, options } = createHarness();
    invoice.lineItems = [];
    expect(getEditingTaxCategory(invoice, options)).toMatchObject({
      ok: true,
      value: { id: "standard-10" },
    });
    options.taxCategories = [];
    expect(getEditingTaxCategory(invoice, options).ok).toBe(false);
    expect(
      prepareInvoiceDraftUpdate(
        invoice,
        createInvoiceDraftForm(invoice),
        options,
      ),
    ).toMatchObject({ ok: true, value: { calculation: { totalAmount: "0" } } });
    const form = createInvoiceDraftForm(invoice);
    form.lineItems.push({
      name: "業務",
      quantity: 1,
      unit: "式",
      unitPrice: 100,
    });
    expect(prepareInvoiceDraftUpdate(invoice, form, options).ok).toBe(false);
  });

  it("未完成の明細を破棄せず、問題をまとめて返して送信しない", async () => {
    const { invoice, options, fetcher } = createHarness();
    const form = createInvoiceDraftForm(invoice);
    form.lineItems.push({
      name: "",
      quantity: undefined,
      unit: "",
      unitPrice: undefined,
    });
    const before = structuredClone(form);
    const result = await saveInvoiceDraftForm(fetcher, invoice, form, options);
    expect(result).toMatchObject({
      ok: false,
      error: {
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ["lineItems", 1, "name"] }),
          expect.objectContaining({ path: ["lineItems", 1, "quantity"] }),
          expect.objectContaining({ path: ["lineItems", 1, "unitPrice"] }),
        ]),
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(form).toEqual(before);
  });

  it("リビジョン競合では入力と期待リビジョンを保持し、自動上書き・再読込をしない", async () => {
    const { invoice, options } = createHarness();
    const current = {
      ...invoice,
      revision: 5,
      notes: "別の処理が保存した内容",
    };
    const saveUpdatedInvoice =
      vi.fn<InvoiceUpdateGateway["saveUpdatedInvoice"]>();
    const gateway: InvoiceUpdateGateway = {
      loadUpdateContext: async () => ({
        invoice: current,
        issuer: createIssuer(),
        taxCategories: options.taxCategories,
      }),
      saveUpdatedInvoice,
    };
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const request = new Request(`http://127.0.0.1${url}`, {
        ...init,
        headers: { ...init?.headers, origin: "http://127.0.0.1" },
      });
      return handleUpdateInvoiceRequest(
        request,
        new URL(request.url),
        invoice.invoiceNumber,
        { gateway },
      );
    });
    const form = createInvoiceDraftForm(invoice);
    form.notes = "未保存の入力";
    const result = await saveInvoiceDraftForm(fetcher, invoice, form, options);
    expect(result).toMatchObject({
      ok: false,
      error: { issues: [expect.objectContaining({ path: ["revision"] })] },
    });
    expect(form.notes).toBe("未保存の入力");
    expect(invoice.revision).toBe(4);
    expect(current.notes).toBe("別の処理が保存した内容");
    expect(saveUpdatedInvoice).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("請求書詳細の操作", () => {
  it("未保存の変更があれば発行を送信せず、保存と発行を一体化しない", async () => {
    const { invoice, fetcher } = createHarness();
    const form = createInvoiceDraftForm(invoice);
    form.notes = "未保存";
    expect(
      await issueSavedInvoice(fetcher, invoice, form, "2026-10-26"),
    ).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("先に保存") },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("保存済みの内容と期待リビジョンだけを発行対象にする", async () => {
    const { invoice, fetcher } = createHarness();
    await issueSavedInvoice(
      fetcher,
      invoice,
      createInvoiceDraftForm(invoice),
      "2026-10-26",
    );
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`/api/invoices/${invoice.invoiceNumber}/issue`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ revision: 4 });
    expect(invoice.status).toBe("draft");
  });
  it("入金日の空欄保存を削除へ読み替えない", async () => {
    const { fetcher } = createHarness();
    const invoice = createInvoiceForPartner(createPartner(), "issued");
    invoice.paymentCompletedDate = "2026-10-25";
    expect(
      (await saveInvoicePayment(fetcher, invoice, "", "2026-10-26")).ok,
    ).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(invoice.paymentCompletedDate).toBe("2026-10-25");
  });
  it("入金日は明示的な日付と期待リビジョンを送り、現在日を補わない", async () => {
    const { fetcher } = createHarness();
    const invoice = createInvoiceForPartner(createPartner(), "issued");
    await saveInvoicePayment(fetcher, invoice, "2025-01-01", "2026-10-26");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toContain("/payment-completed-date");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string)).toEqual({
      revision: 1,
      paymentCompletedDate: "2025-01-01",
    });
    expect(invoice.paymentCompletedDate).toBeNull();
  });
  it.each([
    {
      name: "下書き戻し",
      execute: revertSavedInvoice,
      method: "POST",
      suffix: "/revert-to-draft",
    },
    {
      name: "下書き削除",
      execute: deleteSavedInvoice,
      method: "DELETE",
      suffix: "",
    },
    {
      name: "入金日削除",
      execute: deleteInvoicePayment,
      method: "DELETE",
      suffix: "/payment-completed-date",
    },
  ])(
    "$name は専用APIへ保存済みリビジョンを送る",
    async ({ execute, method, suffix }) => {
      const { invoice, fetcher } = createHarness();
      const before = structuredClone(invoice);
      await execute(fetcher, invoice);
      const [url, init] = fetcher.mock.calls[0];
      expect(url).toBe(`/api/invoices/${invoice.invoiceNumber}${suffix}`);
      expect(init?.method).toBe(method);
      expect(JSON.parse(init?.body as string)).toEqual({ revision: 4 });
      expect(invoice).toEqual(before);
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
});
