import { describe, expect, it, vi } from "vitest";

import { DomainValidationError } from "#lib/domain/domain-validation-error";
import type { Invoice } from "#lib/domain/model";
import {
  revertInvoiceToDraft,
  type InvoiceRevertToDraftGateway,
} from "./revert-invoice-to-draft";

function createInvoice(): Invoice {
  return {
    revision: 3,
    status: "issued",
    invoiceNumber: "ACME-202610-01",
    businessPartner: {
      code: "ACME",
      snapshot: { addressee: "固定した宛名", honorific: "御中" },
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
    issueDate: "2026-10-25",
    transactionDate: "2025-12-31",
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
    notes: "固定した備考",
    rounding: { lineAmount: "floor", taxAmount: "floor" },
    pdf: {
      fileNameOverride: "次回の個別指定",
      issuedFileName: "発行時の名前.pdf",
    },
  };
}

function createHarness(invoice: Invoice | undefined = createInvoice()) {
  const loadInvoice = vi.fn<InvoiceRevertToDraftGateway["loadInvoice"]>(
    async () => invoice,
  );
  const commitRevertedInvoice = vi.fn<
    InvoiceRevertToDraftGateway["commitRevertedInvoice"]
  >(async () => ({
    invoiceFilePath: "sales/invoices/2025/ACME-202610-01.yaml",
    pdfFilePath: "documents/2025/sales/invoices/ACME/発行時の名前.pdf",
  }));
  return {
    invoice,
    gateway: { loadInvoice, commitRevertedInvoice },
    loadInvoice,
    commitRevertedInvoice,
  };
}

describe("請求書の下書き戻し", () => {
  it("番号・請求内容・個別指定を保持し状態・正式ファイル名・リビジョンを更新する", async () => {
    const harness = createHarness();
    const original = structuredClone(harness.invoice);
    const result = await revertInvoiceToDraft(harness.gateway, {
      invoiceNumber: "ACME-202610-01",
      expectedRevision: 3,
    });

    expect(harness.loadInvoice).toHaveBeenCalledWith("ACME-202610-01");
    expect(result.invoice).toEqual({
      ...original,
      revision: 4,
      status: "draft",
      pdf: { fileNameOverride: "次回の個別指定", issuedFileName: null },
    });
    expect(harness.commitRevertedInvoice).toHaveBeenCalledWith(
      original,
      result.invoice,
    );
    expect(result).toMatchObject({
      invoiceFilePath: "sales/invoices/2025/ACME-202610-01.yaml",
      pdfFilePath: "documents/2025/sales/invoices/ACME/発行時の名前.pdf",
    });
    expect(harness.invoice).toEqual(original);
  });

  it("入金完了日とリビジョン不一致をまとめて返し、入金完了日を自動削除しない", async () => {
    const invoice = createInvoice();
    invoice.paymentCompletedDate = "2026-10-24";
    const harness = createHarness(invoice);
    const original = structuredClone(invoice);

    const error = await revertInvoiceToDraft(harness.gateway, {
      invoiceNumber: invoice.invoiceNumber,
      expectedRevision: 2,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DomainValidationError);
    expect((error as DomainValidationError).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["paymentCompletedDate"] }),
        expect.objectContaining({ path: ["revision"] }),
      ]),
    );
    expect(invoice).toEqual(original);
    expect(harness.commitRevertedInvoice).not.toHaveBeenCalled();
  });

  it("下書き状態の請求書は戻さない", async () => {
    const invoice = createInvoice();
    invoice.status = "draft";
    invoice.pdf.issuedFileName = null;
    const harness = createHarness(invoice);
    await expect(
      revertInvoiceToDraft(harness.gateway, {
        invoiceNumber: invoice.invoiceNumber,
        expectedRevision: 3,
      }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["status"] })],
    });
    expect(harness.commitRevertedInvoice).not.toHaveBeenCalled();
  });

  it.each([0, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "不正な期待リビジョン %s を拒否する",
    async (expectedRevision) => {
      const harness = createHarness();
      await expect(
        revertInvoiceToDraft(harness.gateway, {
          invoiceNumber: "ACME-202610-01",
          expectedRevision,
        }),
      ).rejects.toMatchObject({
        issues: [expect.objectContaining({ path: ["revision"] })],
      });
      expect(harness.commitRevertedInvoice).not.toHaveBeenCalled();
    },
  );

  it("存在しない請求書を拒否する", async () => {
    const harness = createHarness();
    harness.loadInvoice.mockResolvedValueOnce(undefined);
    await expect(
      revertInvoiceToDraft(harness.gateway, {
        invoiceNumber: "MISSING-202610-01",
        expectedRevision: 3,
      }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["invoiceNumber"] })],
    });
    expect(harness.commitRevertedInvoice).not.toHaveBeenCalled();
  });

  it("正式ファイル名がなければ破棄処理を行わない", async () => {
    const invoice = createInvoice();
    invoice.pdf.issuedFileName = null;
    const harness = createHarness(invoice);
    await expect(
      revertInvoiceToDraft(harness.gateway, {
        invoiceNumber: invoice.invoiceNumber,
        expectedRevision: 3,
      }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["pdf", "issuedFileName"] })],
    });
    expect(harness.commitRevertedInvoice).not.toHaveBeenCalled();
  });

  it("保存に失敗した場合は元の請求書を変更しない", async () => {
    const harness = createHarness();
    const original = structuredClone(harness.invoice);
    const failure = new Error("PDFを破棄できません。");
    harness.commitRevertedInvoice.mockRejectedValueOnce(failure);
    await expect(
      revertInvoiceToDraft(harness.gateway, {
        invoiceNumber: "ACME-202610-01",
        expectedRevision: 3,
      }),
    ).rejects.toBe(failure);
    expect(harness.invoice).toEqual(original);
  });
});
