import { describe, expect, it, vi } from "vitest";

import type { InvoicePdfRenderer } from "#lib/application/issue-invoice";
import { DomainValidationError } from "#lib/domain/domain-validation-error";
import type { Invoice } from "#lib/domain/model";
import { createInvoiceForPartner } from "#lib/testing/business-partners";
import { createReadData } from "#lib/testing/keiri-read-data";
import {
  regenerateInvoicePdf,
  type InvoicePdfRegenerationGateway,
} from "./regenerate-invoice-pdf";

function createHarness(invoice: Invoice | undefined) {
  const taxCategories = createReadData().taxCategories;
  taxCategories[0].deprecated = true;
  const replaceIssuedPdf = vi.fn<
    InvoicePdfRegenerationGateway["replaceIssuedPdf"]
  >(
    async () => ({ pdfFilePath: "documents/2026/sales/invoices/ACME/保存済み.pdf" }),
  );
  const gateway: InvoicePdfRegenerationGateway = {
    async loadRegenerationContext() {
      return { invoice, taxCategories };
    },
    replaceIssuedPdf,
  };
  const renderSinglePagePdf = vi.fn<InvoicePdfRenderer["renderSinglePagePdf"]>(
    async () => new Uint8Array([1, 2, 3]),
  );
  return {
    gateway,
    renderer: { renderSinglePagePdf },
    replaceIssuedPdf,
    taxCategories,
  };
}

describe("発行済み請求書PDFの再生成", () => {
  it.each([false, true])("税込設定 %s の保存済み内容から再生成し入金情報とリビジョンを維持する", async (inclusive) => {
    const invoice = createInvoiceForPartner(undefined, "issued");
    invoice.revision = 7;
    invoice.paymentCompletedDate = "2026-10-26";
    invoice.unitPricesIncludeTax = inclusive;
    invoice.rounding.taxAmount = "ceil";
    invoice.pdf.issuedFileName = "保存済み.pdf";
    const before = structuredClone(invoice);
    const harness = createHarness(invoice);

    const result = await regenerateInvoicePdf(
      harness.gateway,
      harness.renderer,
      invoice.invoiceNumber,
    );

    expect(result).toEqual({
      invoice: before,
      pdfFilePath: "documents/2026/sales/invoices/ACME/保存済み.pdf",
    });
    expect(invoice).toEqual(before);
    expect(harness.renderer.renderSinglePagePdf).toHaveBeenCalledWith({
      invoice: before,
      taxCategory: harness.taxCategories[0],
      calculation: inclusive
        ? {
            lineAmounts: ["10000"],
            taxableAmount: "9090",
            taxAmount: "910",
            totalAmount: "10000",
          }
        : {
            lineAmounts: ["10000"],
            taxableAmount: "10000",
            taxAmount: "1000",
            totalAmount: "11000",
          },
    });
    expect(harness.replaceIssuedPdf).toHaveBeenCalledWith(
      before,
      new Uint8Array([1, 2, 3]),
    );
  });

  it.each([
    undefined,
    createInvoiceForPartner(),
    {
      ...createInvoiceForPartner(undefined, "issued"),
      pdf: { fileNameOverride: null, issuedFileName: null },
    },
  ])("対象なし・下書き・正式ファイル名なしを生成前に拒否する: %j", async (invoice) => {
    const harness = createHarness(invoice);
    await expect(
      regenerateInvoicePdf(harness.gateway, harness.renderer, "ACME-202610-01"),
    ).rejects.toBeInstanceOf(DomainValidationError);
    expect(harness.renderer.renderSinglePagePdf).not.toHaveBeenCalled();
    expect(harness.replaceIssuedPdf).not.toHaveBeenCalled();
  });

  it("参照する税区分がなければ現在の初期値へ置き換えず拒否する", async () => {
    const invoice = createInvoiceForPartner(undefined, "issued");
    invoice.lineItems[0].taxCategoryId = "missing";
    const harness = createHarness(invoice);
    await expect(
      regenerateInvoicePdf(harness.gateway, harness.renderer, invoice.invoiceNumber),
    ).rejects.toThrow("請求金額を計算できません");
    expect(harness.renderer.renderSinglePagePdf).not.toHaveBeenCalled();
    expect(harness.replaceIssuedPdf).not.toHaveBeenCalled();
  });

  it("フォントなどの生成失敗時にはPDFを置換しない", async () => {
    const invoice = createInvoiceForPartner(undefined, "issued");
    const harness = createHarness(invoice);
    harness.renderer.renderSinglePagePdf.mockRejectedValueOnce(
      new Error("フォントを読み込めません。"),
    );
    await expect(
      regenerateInvoicePdf(harness.gateway, harness.renderer, invoice.invoiceNumber),
    ).rejects.toThrow("フォントを読み込めません");
    expect(harness.replaceIssuedPdf).not.toHaveBeenCalled();
  });
});
