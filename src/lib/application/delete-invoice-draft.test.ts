import { describe, expect, it, vi } from "vitest";

import { DomainValidationError } from "#lib/domain/domain-validation-error";
import type { Invoice } from "#lib/domain/model";
import {
  deleteInvoiceDraft,
  type InvoiceDeletionGateway,
} from "./delete-invoice-draft";

function createInvoice(): Invoice {
  return {
    revision: 2,
    status: "draft",
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
    invoiceDate: "2026-10-25",
    paymentDueDate: "2026-11-30",
    paymentCompletedDate: null,
    unitPricesIncludeTax: false,
    lineItems: [],
    notes: null,
    rounding: { lineAmount: "floor", taxAmount: "floor" },
    pdf: { fileNameOverride: null, issuedFileName: null },
  };
}

function createHarness(invoice = createInvoice()) {
  const loadInvoice = vi.fn<InvoiceDeletionGateway["loadInvoice"]>(
    async () => invoice,
  );
  const deleteInvoice = vi.fn<InvoiceDeletionGateway["deleteInvoice"]>(
    async () => ({ filePath: "sales/invoices/2025/ACME-202610-01.yaml" }),
  );
  return {
    invoice,
    loadInvoice,
    deleteInvoice,
    gateway: { loadInvoice, deleteInvoice },
  };
}

describe("請求書下書きの削除", () => {
  it("明細が空の下書きも削除し、削除対象の番号とパスを返す", async () => {
    const harness = createHarness();
    const result = await deleteInvoiceDraft(harness.gateway, {
      invoiceNumber: harness.invoice.invoiceNumber,
      expectedRevision: 2,
    });

    expect(result).toEqual({
      invoiceNumber: "ACME-202610-01",
      filePath: "sales/invoices/2025/ACME-202610-01.yaml",
    });
    expect(harness.loadInvoice).toHaveBeenCalledWith("ACME-202610-01");
    expect(harness.deleteInvoice).toHaveBeenCalledWith(harness.invoice);
    expect(harness.deleteInvoice).toHaveBeenCalledOnce();
  });

  it("発行済み状態とリビジョン不一致を列挙し削除しない", async () => {
    const invoice = createInvoice();
    invoice.status = "issued";
    invoice.pdf.issuedFileName = "請求書.pdf";
    const harness = createHarness(invoice);
    const error = await deleteInvoiceDraft(harness.gateway, {
      invoiceNumber: invoice.invoiceNumber,
      expectedRevision: 1,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DomainValidationError);
    expect((error as DomainValidationError).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["status"] }),
        expect.objectContaining({ path: ["revision"] }),
      ]),
    );
    expect(harness.deleteInvoice).not.toHaveBeenCalled();
  });

  it("下書きでも期待リビジョンが一致しなければ削除しない", async () => {
    const harness = createHarness();
    await expect(
      deleteInvoiceDraft(harness.gateway, {
        invoiceNumber: harness.invoice.invoiceNumber,
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["revision"] })],
    });
    expect(harness.deleteInvoice).not.toHaveBeenCalled();
  });

  it.each([0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "不正な期待リビジョン %s を拒否する",
    async (expectedRevision) => {
      const harness = createHarness();
      await expect(
        deleteInvoiceDraft(harness.gateway, {
          invoiceNumber: harness.invoice.invoiceNumber,
          expectedRevision,
        }),
      ).rejects.toMatchObject({
        issues: [expect.objectContaining({ path: ["revision"] })],
      });
      expect(harness.deleteInvoice).not.toHaveBeenCalled();
    },
  );

  it("存在しない請求書を拒否する", async () => {
    const harness = createHarness();
    harness.loadInvoice.mockResolvedValueOnce(undefined);
    await expect(
      deleteInvoiceDraft(harness.gateway, {
        invoiceNumber: "MISSING-202610-01",
        expectedRevision: 2,
      }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["invoiceNumber"] })],
    });
    expect(harness.deleteInvoice).not.toHaveBeenCalled();
  });

  it("ファイル削除の失敗を呼び出し元へ返す", async () => {
    const harness = createHarness();
    const before = structuredClone(harness.invoice);
    const failure = new Error("YAMLを削除できません。");
    harness.deleteInvoice.mockRejectedValueOnce(failure);
    await expect(
      deleteInvoiceDraft(harness.gateway, {
        invoiceNumber: harness.invoice.invoiceNumber,
        expectedRevision: 2,
      }),
    ).rejects.toBe(failure);
    expect(harness.invoice).toEqual(before);
  });
});
