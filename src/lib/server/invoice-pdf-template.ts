import { formatBusinessDate } from "#lib/domain/business-date";
import type { InvoicePdfRenderInput } from "#lib/application/issue-invoice";

const yenFormatter = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 0,
});

export function buildInvoicePdfHtml(
  input: InvoicePdfRenderInput,
  fontDataUrl: string,
): string {
  const { invoice, taxCategory, calculation } = input;
  const taxLabel = invoice.unitPricesIncludeTax
    ? `うち消費税（${taxCategory.ratePercent}%）`
    : `消費税（${taxCategory.ratePercent}%）`;
  const subtotal = invoice.unitPricesIncludeTax
    ? calculation.totalAmount
    : calculation.taxableAmount;
  const lineItems = invoice.lineItems
    .map(
      (lineItem, index) => `
        <tr>
          <td class="item-name">${escapeHtml(lineItem.name)}</td>
          <td class="number quantity">${escapeHtml(formatQuantity(lineItem.quantity))} ${escapeHtml(lineItem.unit)}</td>
          <td class="number">${formatYen(lineItem.unitPrice)}</td>
          <td class="number">${formatYen(calculation.lineAmounts[index])}</td>
        </tr>`,
    )
    .join("");
  const contacts = [
    invoice.issuer.snapshot.phone.visible
      ? `<div>TEL: ${escapeHtml(invoice.issuer.snapshot.phone.value)}</div>`
      : "",
    invoice.issuer.snapshot.email.visible
      ? `<div>${escapeHtml(invoice.issuer.snapshot.email.value)}</div>`
      : "",
  ].join("");
  const bankAccounts = invoice.issuer.snapshot.bankAccounts
    .map(
      (account) => `
        <div class="bank-account">
          <span>${escapeHtml(account.bankName)}</span>
          <span>${escapeHtml(account.branchName)}${account.branchCode === null ? "" : `（支店番号 ${escapeHtml(account.branchCode)}）`}</span>
          <span>${account.accountType === "ordinary" ? "普通" : "当座"} ${escapeHtml(account.accountNumber)}</span>
          <span>${escapeHtml(account.accountHolderName)}</span>
        </div>`,
    )
    .join("");
  const transactionDate =
    invoice.transactionDate === invoice.issueDate
      ? ""
      : `<div><dt>取引日</dt><dd>${formatBusinessDate(invoice.transactionDate)}</dd></div>`;
  const notes =
    invoice.notes === null
      ? ""
      : `<section class="notes"><h2>備考</h2><p>${escapeHtml(invoice.notes)}</p></section>`;

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <style>
      @font-face {
        font-family: "Noto Sans JP";
        src: url("${fontDataUrl}") format("truetype");
        font-style: normal;
        font-weight: 100 900;
      }

      @page {
        size: A4;
        margin: 14mm 15mm 13mm;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        color: #172033;
        font-family: "Noto Sans JP";
        font-size: 9.5pt;
        font-variant-numeric: tabular-nums;
        line-height: 1.5;
      }

      body {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }

      .page {
        width: 180mm;
        min-height: 270mm;
      }

      .document-header {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: start;
        min-height: 29mm;
      }

      h1 {
        grid-column: 2;
        margin: 10mm 0 0;
        color: #111827;
        font-size: 24pt;
        font-weight: 700;
        letter-spacing: 0.14em;
        line-height: 1;
      }

      .document-meta {
        grid-column: 3;
        justify-self: end;
        width: max-content;
        margin: 0;
        font-size: 8.5pt;
      }

      .document-meta > div {
        display: grid;
        grid-template-columns: auto auto;
        gap: 3mm;
      }

      .document-meta dt {
        color: #5c667a;
      }

      .document-meta dd {
        margin: 0;
        text-align: right;
      }

      .parties {
        display: grid;
        grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
        gap: 16mm;
        min-height: 37mm;
      }

      .recipient {
        padding-top: 3mm;
      }

      .recipient-name {
        display: inline;
        border-bottom: 0.4mm solid #172033;
        font-size: 14pt;
        font-weight: 700;
        line-height: 1.8;
      }

      .greeting {
        margin: 5mm 0 0;
      }

      .issuer {
        padding-top: 3mm;
      }

      .issuer-name {
        margin-bottom: 1mm;
        font-size: 11pt;
        font-weight: 700;
      }

      .issuer-registration {
        margin-bottom: 1mm;
      }

      .amount-summary {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16mm;
        align-items: end;
        margin: 2mm 0 8mm;
      }

      .amount-due {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: baseline;
        gap: 5mm;
        border-bottom: 0.6mm solid #172033;
        padding: 0 0 1.5mm;
      }

      .amount-due span {
        font-size: 12pt;
        font-weight: 700;
      }

      .amount-due strong {
        text-align: right;
        font-size: 16pt;
        font-weight: 700;
      }

      .payment-due {
        margin-top: 3mm;
        font-weight: 500;
      }

      .tax-mode {
        color: #5c667a;
        text-align: right;
        font-size: 8pt;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      .line-items {
        table-layout: fixed;
      }

      .line-items th,
      .line-items td {
        border: 0.25mm solid #30394a;
        padding: 2.2mm 2.5mm;
        vertical-align: top;
      }

      .line-items th {
        background: #e9edf3;
        text-align: center;
        font-weight: 700;
      }

      .line-items th:first-child {
        width: 55%;
      }

      .line-items th:nth-child(2) {
        width: 15%;
      }

      .line-items th:nth-child(3),
      .line-items th:nth-child(4) {
        width: 15%;
      }

      .item-name {
        overflow-wrap: anywhere;
      }

      .number {
        text-align: right;
        white-space: nowrap;
      }

      .totals {
        width: 45%;
        margin-left: auto;
        border-collapse: collapse;
      }

      .totals th,
      .totals td {
        border: 0.25mm solid #30394a;
        padding: 2mm 2.5mm;
      }

      .totals th {
        background: #f5f7fa;
        text-align: left;
        font-weight: 500;
      }

      .totals td {
        text-align: right;
        white-space: nowrap;
      }

      .totals .grand-total th,
      .totals .grand-total td {
        border-top-width: 0.5mm;
        font-weight: 700;
      }

      .footer-content {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 12mm;
        margin-top: 8mm;
      }

      .footer-content h2 {
        margin: 0 0 1.5mm;
        font-size: 10pt;
      }

      .bank-account {
        display: flex;
        flex-wrap: wrap;
        column-gap: 2mm;
        margin-bottom: 1mm;
      }

      .bank-account span {
        white-space: nowrap;
      }

      .notes p {
        margin: 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="document-header">
        <h1>請求書</h1>
        <dl class="document-meta">
          <div><dt>発行日</dt><dd>${formatBusinessDate(invoice.issueDate)}</dd></div>
          ${transactionDate}
          <div><dt>請求書番号</dt><dd>${escapeHtml(invoice.invoiceNumber)}</dd></div>
        </dl>
      </header>

      <section class="parties">
        <div class="recipient">
          <div class="recipient-name">${escapeHtml(invoice.businessPartner.snapshot.addressee)} ${escapeHtml(invoice.businessPartner.snapshot.honorific)}</div>
          <p class="greeting">下記のとおりご請求申し上げます。</p>
        </div>
        <div class="issuer">
          <div class="issuer-name">${escapeHtml(invoice.issuer.snapshot.name)}</div>
          <div class="issuer-registration">登録番号: ${escapeHtml(invoice.issuer.snapshot.registrationNumber)}</div>
          ${contacts}
        </div>
      </section>

      <section class="amount-summary">
        <div>
          <div class="amount-due"><span>ご請求金額</span><strong>¥ ${formatYen(calculation.totalAmount)}</strong></div>
          <div class="payment-due">お支払い期限: ${formatBusinessDate(invoice.paymentDueDate)}</div>
        </div>
        <div class="tax-mode">単価は${invoice.unitPricesIncludeTax ? "税込" : "税抜"}です</div>
      </section>

      <table class="line-items">
        <thead>
          <tr><th>品目・品名</th><th>数量</th><th>単価</th><th>金額</th></tr>
        </thead>
        <tbody>${lineItems}</tbody>
      </table>

      <table class="totals">
        <tbody>
          <tr><th>${invoice.unitPricesIncludeTax ? "税込小計" : "小計"}</th><td>${formatYen(subtotal)}</td></tr>
          <tr><th>${taxLabel}</th><td>${formatYen(calculation.taxAmount)}</td></tr>
          <tr class="grand-total"><th>合計</th><td>${formatYen(calculation.totalAmount)}</td></tr>
        </tbody>
      </table>

      <div class="footer-content">
        <section class="bank-accounts"><h2>お振込先</h2>${bankAccounts}</section>
        ${notes}
      </div>
    </main>
  </body>
</html>`;
}

function formatYen(value: string | number): string {
  return yenFormatter.format(BigInt(value));
}

function formatQuantity(value: number): string {
  return String(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
