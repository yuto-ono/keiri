import { describe, expect, it, vi } from "vitest";

import { DomainValidationError } from "#lib/domain/domain-validation-error";
import type { Invoice } from "#lib/domain/model";
import {
  deleteInvoicePaymentCompletedDate,
  setInvoicePaymentCompletedDate,
  type InvoicePaymentGateway,
} from "./manage-invoice-payment";

function createInvoice(): Invoice {
  return {
    revision: 3,
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
            branchCode: "001",
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
        quantity: 2,
        unit: "時間",
        unitPrice: 10_000,
        taxCategoryId: "standard-10",
      },
    ],
    notes: "固定済みの備考",
    rounding: { lineAmount: "floor", taxAmount: "floor" },
    pdf: { fileNameOverride: "個別指定", issuedFileName: "発行時の名前.pdf" },
  };
}

function createHarness(overrides: Partial<Invoice> = {}) {
  const invoice = { ...createInvoice(), ...overrides };
  const loadInvoice = vi.fn<InvoicePaymentGateway["loadInvoice"]>(
    async () => invoice,
  );
  const saveInvoicePayment = vi.fn<InvoicePaymentGateway["saveInvoicePayment"]>(
    async () => ({ filePath: "sales/invoices/2027/ACME-202610-01.yaml" }),
  );
  return {
    invoice,
    loadInvoice,
    saveInvoicePayment,
    gateway: { loadInvoice, saveInvoicePayment },
  };
}

function changeDate(
  action: "set" | "delete",
  gateway: InvoicePaymentGateway,
  expectedRevision = 3,
) {
  const input = { invoiceNumber: "ACME-202610-01", expectedRevision };
  return action === "set"
    ? setInvoicePaymentCompletedDate(gateway, {
        ...input,
        paymentCompletedDate: "2026-10-25",
        today: "2026-10-25",
      })
    : deleteInvoicePaymentCompletedDate(gateway, input);
}

describe("請求書の入金管理", () => {
  it.each([
    { previous: null, date: "2026-10-25" },
    { previous: "2026-10-24", date: "2025-01-01" },
  ])(
    "入金完了日を $previous から $date へ記録・更新し、請求内容とPDFの記録を維持する",
    async ({ previous, date }) => {
      const harness = createHarness({ paymentCompletedDate: previous });
      const before = structuredClone(harness.invoice);
      const result = await setInvoicePaymentCompletedDate(harness.gateway, {
        invoiceNumber: harness.invoice.invoiceNumber,
        expectedRevision: 3,
        paymentCompletedDate: date,
        today: "2026-10-25",
      });

      expect(harness.loadInvoice).toHaveBeenCalledWith(
        harness.invoice.invoiceNumber,
      );
      expect(result.invoice).toEqual({
        ...before,
        revision: 4,
        paymentCompletedDate: date,
      });
      expect(result.filePath).toBe("sales/invoices/2027/ACME-202610-01.yaml");
      expect(harness.saveInvoicePayment).toHaveBeenCalledWith(
        before,
        result.invoice,
      );
      expect(harness.invoice).toEqual(before);
    },
  );

  it("入金完了日を削除し、発行済み状態と請求内容を維持する", async () => {
    const harness = createHarness({ paymentCompletedDate: "2026-10-24" });
    const before = structuredClone(harness.invoice);
    const result = await changeDate("delete", harness.gateway);
    expect(result.invoice).toEqual({
      ...before,
      revision: 4,
      paymentCompletedDate: null,
    });
    expect(harness.saveInvoicePayment).toHaveBeenCalledWith(
      before,
      result.invoice,
    );
    expect(harness.invoice).toEqual(before);
  });

  it.each(["2026-10-26", "2026-02-29", "2026-10-24T00:00:00+09:00", ""])(
    "未来日または不正な日付 %s を拒否する",
    async (paymentCompletedDate) => {
      const harness = createHarness();
      await expect(
        setInvoicePaymentCompletedDate(harness.gateway, {
          invoiceNumber: harness.invoice.invoiceNumber,
          expectedRevision: 3,
          paymentCompletedDate,
          today: "2026-10-25",
        }),
      ).rejects.toMatchObject({
        issues: [expect.objectContaining({ path: ["paymentCompletedDate"] })],
      });
      expect(harness.saveInvoicePayment).not.toHaveBeenCalled();
    },
  );

  it("下書き状態・未来日・リビジョン不一致をまとめて返す", async () => {
    const harness = createHarness({
      status: "draft",
      pdf: { fileNameOverride: null, issuedFileName: null },
    });
    const error = await setInvoicePaymentCompletedDate(harness.gateway, {
      invoiceNumber: harness.invoice.invoiceNumber,
      expectedRevision: 2,
      paymentCompletedDate: "2026-10-26",
      today: "2026-10-25",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DomainValidationError);
    expect((error as DomainValidationError).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["status"] }),
        expect.objectContaining({ path: ["paymentCompletedDate"] }),
        expect.objectContaining({ path: ["revision"] }),
      ]),
    );
    expect(harness.saveInvoicePayment).not.toHaveBeenCalled();
  });

  it("下書きでは入金完了日の削除も拒否する", async () => {
    const harness = createHarness({
      status: "draft",
      pdf: { fileNameOverride: null, issuedFileName: null },
    });
    await expect(changeDate("delete", harness.gateway)).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["status"] })],
    });
    expect(harness.saveInvoicePayment).not.toHaveBeenCalled();
  });

  it.each(["set", "delete"] as const)(
    "%s の期待リビジョンが一致しなければ保存しない",
    async (action) => {
      const harness = createHarness({ paymentCompletedDate: "2026-10-24" });
      await expect(
        changeDate(action, harness.gateway, 2),
      ).rejects.toMatchObject({
        issues: [expect.objectContaining({ path: ["revision"] })],
      });
      expect(harness.saveInvoicePayment).not.toHaveBeenCalled();
    },
  );

  it.each([0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "不正な期待リビジョン %s を拒否する",
    async (revision) => {
      const harness = createHarness();
      await expect(
        changeDate("set", harness.gateway, revision),
      ).rejects.toMatchObject({
        issues: [expect.objectContaining({ path: ["revision"] })],
      });
      expect(harness.saveInvoicePayment).not.toHaveBeenCalled();
    },
  );

  it.each(["set", "delete"] as const)(
    "%s の対象請求書がなければ保存しない",
    async (action) => {
      const harness = createHarness();
      harness.loadInvoice.mockResolvedValueOnce(undefined);
      await expect(changeDate(action, harness.gateway)).rejects.toMatchObject({
        issues: [expect.objectContaining({ path: ["invoiceNumber"] })],
      });
      expect(harness.saveInvoicePayment).not.toHaveBeenCalled();
    },
  );

  it.each(["set", "delete"] as const)(
    "%s の保存に失敗しても元の請求書を変更しない",
    async (action) => {
      const harness = createHarness({ paymentCompletedDate: "2026-10-24" });
      const before = structuredClone(harness.invoice);
      const failure = new Error("YAMLを保存できません。");
      harness.saveInvoicePayment.mockRejectedValueOnce(failure);
      await expect(changeDate(action, harness.gateway)).rejects.toBe(failure);
      expect(harness.invoice).toEqual(before);
    },
  );
});
