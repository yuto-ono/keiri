import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import type { InvoicePdfRenderInput } from "#lib/application/issue-invoice";

import { PlaywrightInvoicePdfRenderer } from "./playwright-invoice-pdf-renderer";

function createInput(): InvoicePdfRenderInput {
  const lineItems = Array.from({ length: 10 }, (_, index) => ({
    name: `開発・保守業務 ${index + 1}`,
    quantity: index % 2 === 0 ? 1 : 1.5,
    unit: "時間",
    unitPrice: 10_000,
    taxCategoryId: "standard-10",
  }));
  return {
    invoice: {
      revision: 2,
      status: "issued",
      invoiceNumber: "ACME-202610-01",
      businessPartner: {
        code: "ACME",
        snapshot: { addressee: "株式会社サンプル", honorific: "御中" },
      },
      issuer: {
        id: "issuer",
        snapshot: {
          name: "山田太郎",
          registrationNumber: "T1234567890123",
          phone: { visible: true, value: "00-0000-0000" },
          email: { visible: true, value: "invoice@example.com" },
          bankAccounts: [
            {
              id: "primary",
              bankName: "サンプル銀行",
              branchName: "本店",
              branchCode: "001",
              accountType: "ordinary",
              accountNumber: "1234567",
              accountHolderName: "ヤマダタロウ",
            },
            {
              id: "secondary",
              bankName: "第二銀行",
              branchName: "中央支店",
              branchCode: null,
              accountType: "checking",
              accountNumber: "7654321",
              accountHolderName: "ヤマダタロウ",
            },
          ],
        },
      },
      invoiceDate: "2026-10-20",
      paymentDueDate: "2026-11-30",
      paymentCompletedDate: null,
      unitPricesIncludeTax: false,
      lineItems,
      notes: "翌月末までにお振り込みください。\n振込手数料はご負担ください。",
      rounding: { lineAmount: "floor", taxAmount: "floor" },
      pdf: {
        fileNameOverride: null,
        issuedFileName: "ACME-202610-01.pdf",
      },
    },
    taxCategory: {
      id: "standard-10",
      name: "標準10%",
      treatment: "taxable",
      deprecated: false,
      isStandardRate: true,
      ratePercent: 10,
    },
    calculation: {
      lineAmounts: lineItems.map((item) =>
        String(item.quantity * item.unitPrice),
      ),
      taxableAmount: "125000",
      taxAmount: "12500",
      totalAmount: "137500",
    },
  };
}

describe("Playwrightを使う請求書PDFレンダラー", () => {
  it("Noto Sans JPで最大10明細をA4の1ページへ生成する", async () => {
    const renderer = new PlaywrightInvoicePdfRenderer(process.cwd());

    const contents = await renderer.renderSinglePagePdf(createInput());
    const document = await PDFDocument.load(contents);

    expect(document.getPageCount()).toBe(1);
    expect(contents.byteLength).toBeGreaterThan(10_000);
  });
});
