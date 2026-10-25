import { describe, expect, it } from "vitest";

import type { InvoicePdfRenderInput } from "#lib/application/issue-invoice";

import { buildInvoicePdfHtml } from "./invoice-pdf-template";

function createInput(): InvoicePdfRenderInput {
  return {
    invoice: {
      revision: 2,
      status: "issued",
      invoiceNumber: "ACME-202610-01",
      businessPartner: {
        code: "ACME",
        snapshot: {
          addressee: "株式会社サンプル <営業部>",
          honorific: "御中",
        },
      },
      issuer: {
        id: "issuer",
        snapshot: {
          name: "山田 & 太郎",
          registrationNumber: "T1234567890123",
          phone: { visible: true, value: "00-0000-0000" },
          email: { visible: false },
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
          ],
        },
      },
      issueDate: "2026-10-20",
      transactionDate: "2026-09-30",
      paymentDueDate: "2026-11-30",
      paymentCompletedDate: null,
      unitPricesIncludeTax: false,
      lineItems: [
        {
          name: "開発 <保守> & 運用",
          quantity: 2.5,
          unit: "時間",
          unitPrice: 10_000,
          taxCategoryId: "standard-10",
        },
      ],
      notes: "1行目\n2行目",
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
      lineAmounts: ["25000"],
      taxableAmount: "25000",
      taxAmount: "2500",
      totalAmount: "27500",
    },
  };
}

describe("請求書PDFのHTML", () => {
  it("請求内容を表示し、外部入力をHTMLとして解釈させない", () => {
    const html = buildInvoicePdfHtml(
      createInput(),
      "data:font/ttf;base64,Zm9udA==",
    );

    expect(html).toContain("株式会社サンプル &lt;営業部&gt; 御中");
    expect(html).toContain("山田 &amp; 太郎");
    expect(html).toContain("開発 &lt;保守&gt; &amp; 運用");
    expect(html).not.toContain("株式会社サンプル <営業部>");
    expect(html).toContain("<dt>取引日</dt><dd>2026年09月30日</dd>");
    expect(html).toContain("登録番号: T1234567890123");
    expect(html).toContain("¥ 27,500");
    expect(html).toContain("2.5 時間");
    expect(html).toContain("white-space: pre-wrap");
  });

  it("発行日と取引日が同じ場合は取引日を重複表示しない", () => {
    const input = createInput();
    input.invoice.transactionDate = input.invoice.issueDate;

    const html = buildInvoicePdfHtml(input, "data:font/ttf;base64,Zm9udA==");

    expect(html).not.toContain("<dt>取引日</dt>");
  });

  it("安全な整数を超える計算結果も精度を落とさず表示する", () => {
    const input = createInput();
    input.calculation.totalAmount = "999999999999999999999999";

    const html = buildInvoicePdfHtml(input, "data:font/ttf;base64,Zm9udA==");

    expect(html).toContain("999,999,999,999,999,999,999,999");
  });
});
