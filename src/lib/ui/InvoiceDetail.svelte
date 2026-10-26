<script lang="ts">
  import { tick, untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import type { Invoice } from "#lib/domain/model";
  import { formatBusinessDate, todayInTokyo } from "#lib/domain/business-date";
  import { resolveInvoiceAmounts } from "#lib/domain/invoice-calculation";
  import { formatRoundingMethod, formatYen } from "#lib/ui/format";
  import {
    readJsonApi,
    type ApiReadError,
    type ApiReadResult,
  } from "#lib/ui/read-api";
  import {
    createInvoiceDraftForm,
    getSavedInvoiceFieldContext,
    deleteInvoicePayment,
    deleteSavedInvoice,
    hasInvoiceDraftChanges,
    invoiceApiPath,
    issueSavedInvoice,
    prepareInvoiceDraftUpdate,
    revertSavedInvoice,
    saveInvoiceDraftForm,
    saveInvoicePayment,
    type InvoiceDetailData,
  } from "#lib/ui/invoice-editor";
  import InvoiceDraftFields from "./InvoiceDraftFields.svelte";
  import InvoiceIssuer from "./InvoiceIssuer.svelte";
  import InlineError from "./InlineError.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";

  let { detail }: { detail: InvoiceDetailData } = $props();
  let heading: HTMLHeadingElement;
  let screen = $state(untrack(() => detail));
  let saved = $state(untrack(() => detail.invoice));
  let form = $state(untrack(() => createInvoiceDraftForm(detail.invoice)));
  let paymentDate = $state(
    untrack(() => detail.invoice.paymentCompletedDate ?? ""),
  );
  let busy = $state(false);
  let operationError = $state<ApiReadError | null>(null);
  let message = $state("");
  let confirmation = $state<"revert" | "delete" | "delete-payment" | null>(
    null,
  );
  let dirty = $derived(hasInvoiceDraftChanges(saved, form));
  let preview = $derived(
    prepareInvoiceDraftUpdate(saved, form, screen.editOptions),
  );
  let amounts = $derived(
    resolveInvoiceAmounts(saved, screen.editOptions.taxCategories),
  );
  let pdfUrl = $derived(
    `${resolve("/api/invoices/[invoiceNumber]/pdf", { invoiceNumber: saved.invoiceNumber })}?revision=${saved.revision}`,
  );

  function acceptInvoice(invoice: Invoice) {
    saved = invoice;
    form = createInvoiceDraftForm(invoice);
    paymentDate = invoice.paymentCompletedDate ?? "";
  }
  async function change(
    execute: () => Promise<ApiReadResult<{ invoice: Invoice }>>,
    successMessage: string,
  ) {
    if (busy) return;
    busy = true;
    operationError = null;
    message = "";
    try {
      const result = await execute();
      if (result.ok) {
        const previousStatus = saved.status;
        acceptInvoice(result.value.invoice);
        message = `${successMessage}（リビジョン${result.value.invoice.revision}）`;
        if (previousStatus !== result.value.invoice.status) {
          await tick();
          heading.focus();
        }
      } else operationError = result.error;
    } finally {
      busy = false;
    }
  }
  async function reload() {
    if (busy) return;
    busy = true;
    operationError = null;
    message = "";
    try {
      const result = await readJsonApi<InvoiceDetailData>(
        fetch,
        invoiceApiPath(saved.invoiceNumber),
      );
      if (result.ok) {
        screen = result.value;
        acceptInvoice(result.value.invoice);
        message = "最新データを読み直しました。";
      } else operationError = result.error;
    } finally {
      busy = false;
    }
  }
  async function confirmOperation() {
    const operation = confirmation;
    confirmation = null;
    if (operation === "revert")
      return change(
        () => revertSavedInvoice(fetch, saved),
        "下書きへ戻しました",
      );
    if (operation === "delete-payment")
      return change(
        () => deleteInvoicePayment(fetch, saved),
        "入金完了日を削除しました",
      );
    if (operation === "delete") {
      busy = true;
      operationError = null;
      message = "";
      try {
        const result = await deleteSavedInvoice(fetch, saved);
        if (result.ok)
          await goto(
            resolve(`/invoices?year=${saved.transactionDate.slice(0, 4)}`),
            { refreshAll: true },
          );
        else operationError = result.error;
      } finally {
        busy = false;
      }
    }
  }
</script>

<svelte:head><title>{saved.invoiceNumber} | keiri</title></svelte:head>
<p class="back-link">
  <a href={resolve(`/invoices?year=${saved.transactionDate.slice(0, 4)}`)}
    >請求書一覧へ戻る</a
  >
</p>
<header class="page-header">
  <div>
    <h1 bind:this={heading} tabindex="-1">{saved.invoiceNumber}</h1>
    <p class="muted">
      {saved.status === "draft" ? "下書き" : "発行済み"} / リビジョン {saved.revision}
    </p>
  </div>
  <div class="actions">
    <a
      class="button-link"
      href={resolve("/invoices/[invoiceNumber]/duplicate", {
        invoiceNumber: saved.invoiceNumber,
      })}
      aria-disabled={busy}
      onclick={(event) => {
        if (busy) event.preventDefault();
      }}>複製する</a
    ><button type="button" disabled={busy} onclick={reload}
      >最新データを読み直す</button
    >
  </div>
</header>
{#if operationError}<InlineError error={operationError} focus={true} />{/if}
{#if message}<p class="operation-message" role="status">{message}</p>{/if}

{#if saved.status === "draft"}
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void change(
        () => saveInvoiceDraftForm(fetch, saved, form, screen.editOptions),
        "保存しました",
      );
    }}
  >
    <fieldset disabled={busy}>
      <InvoiceDraftFields
        bind:form
        context={getSavedInvoiceFieldContext(saved, screen.editOptions)}
        calculation={preview.ok ? preview.value.calculation : null}
      />
      <div class="panel content-panel">
        <h2>請求金額</h2>
        <dl class="details-grid">
          <div>
            <dt>税抜額</dt>
            <dd>
              {preview.ok
                ? formatYen(preview.value.calculation.taxableAmount)
                : "—"}
            </dd>
          </div>
          <div>
            <dt>消費税額</dt>
            <dd>
              {preview.ok
                ? formatYen(preview.value.calculation.taxAmount)
                : "—"}
            </dd>
          </div>
          <div>
            <dt>請求合計</dt>
            <dd class="total-amount">
              {preview.ok
                ? formatYen(preview.value.calculation.totalAmount)
                : "—"}
            </dd>
          </div>
        </dl>
        <p class="muted">
          明細金額：{formatRoundingMethod(saved.rounding.lineAmount)} / 消費税額：{formatRoundingMethod(
            saved.rounding.taxAmount,
          )}
        </p>
        <div class="actions">
          <button type="submit" class="primary"
            >{busy ? "処理中…" : "保存する"}</button
          >
        </div>
      </div>
    </fieldset>
  </form>
  <InvoiceIssuer snapshot={saved.issuer.snapshot} showBanks={false} />
  <section class="panel content-panel" aria-label="請求書の操作">
    {#if dirty}<p>
        未保存の変更があります。発行する前に保存してください。
      </p>{/if}
    {#if dirty}<p class="muted">複製には保存済みの内容を使います。</p>{/if}
    <div class="actions">
      <button
        type="button"
        class="primary"
        disabled={busy || dirty}
        onclick={() =>
          change(
            () => issueSavedInvoice(fetch, saved, form, todayInTokyo()),
            "発行しました",
          )}>発行する</button
      ><button
        type="button"
        class="danger"
        disabled={busy}
        onclick={() => (confirmation = "delete")}>下書きを削除</button
      >
    </div>
  </section>
{:else}
  <section class="panel content-panel" aria-labelledby="issued-content-heading">
    <h2 id="issued-content-heading">請求内容</h2>
    <dl class="details-grid">
      <div>
        <dt>取引先コード</dt>
        <dd>{saved.businessPartner.code}</dd>
      </div>
      <div>
        <dt>宛名</dt>
        <dd>
          {saved.businessPartner.snapshot.addressee}{saved.businessPartner
            .snapshot.honorific}
        </dd>
      </div>
      <div>
        <dt>発行日</dt>
        <dd>{formatBusinessDate(saved.issueDate)}</dd>
      </div>
      <div>
        <dt>取引日</dt>
        <dd>{formatBusinessDate(saved.transactionDate)}</dd>
      </div>
      <div>
        <dt>支払期限</dt>
        <dd>{formatBusinessDate(saved.paymentDueDate)}</dd>
      </div>
      <div>
        <dt>単価</dt>
        <dd>{saved.unitPricesIncludeTax ? "税込" : "税抜"}</dd>
      </div>
      <div>
        <dt>税区分</dt>
        <dd>
          {amounts.taxCategory?.name}（課税・標準税率 {amounts.taxCategory
            ?.ratePercent}%）
        </dd>
      </div>
    </dl>
    <div class="table-scroll">
      <table class="data-table">
        <thead
          ><tr
            ><th scope="col">品目名</th><th scope="col" class="amount">数量</th
            ><th scope="col">単位</th><th scope="col" class="amount">単価</th
            ><th scope="col" class="amount">明細金額</th></tr
          ></thead
        ><tbody>
          {#each saved.lineItems as item, index (index)}<tr
              ><td class="item-name">{item.name}</td><td class="amount"
                >{item.quantity}</td
              ><td>{item.unit}</td><td class="amount"
                >{formatYen(String(item.unitPrice))}</td
              ><td class="amount"
                >{formatYen(amounts.calculation.lineAmounts[index])}</td
              ></tr
            >{/each}
        </tbody>
      </table>
    </div>
    <dl class="details-grid totals">
      <div>
        <dt>税抜額</dt>
        <dd>{formatYen(amounts.calculation.taxableAmount)}</dd>
      </div>
      <div>
        <dt>消費税額</dt>
        <dd>{formatYen(amounts.calculation.taxAmount)}</dd>
      </div>
      <div>
        <dt>請求合計</dt>
        <dd class="total-amount">
          {formatYen(amounts.calculation.totalAmount)}
        </dd>
      </div>
    </dl>
    <p class="muted">
      明細金額：{formatRoundingMethod(saved.rounding.lineAmount)} / 消費税額：{formatRoundingMethod(
        saved.rounding.taxAmount,
      )}
    </p>
    <h3>備考</h3>
    <p class="notes">{saved.notes ?? "なし"}</p>
    <h3>PDFファイル名</h3>
    <p class="notes">{saved.pdf.issuedFileName}</p>
  </section>
  <InvoiceIssuer snapshot={saved.issuer.snapshot} showBanks={true} />
  <section class="panel content-panel" aria-labelledby="payment-heading">
    <h2 id="payment-heading">入金管理</h2>
    <p>
      {saved.paymentCompletedDate === null
        ? "入金未確認"
        : `入金確認済み：${formatBusinessDate(saved.paymentCompletedDate)}`}
    </p>
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void change(
          () => saveInvoicePayment(fetch, saved, paymentDate, todayInTokyo()),
          saved.paymentCompletedDate === null
            ? "入金完了日を記録しました"
            : "入金完了日を更新しました",
        );
      }}
    >
      <fieldset disabled={busy}>
        <label class="payment-date"
          >入金完了日<input
            type="date"
            required
            max={screen.today}
            onfocus={() => (screen.today = todayInTokyo())}
            bind:value={paymentDate}
          /></label
        >
        <div class="actions">
          <button type="submit" class="primary"
            >{saved.paymentCompletedDate === null
              ? "記録する"
              : "更新する"}</button
          >{#if saved.paymentCompletedDate !== null}<button
              type="button"
              class="danger"
              onclick={() => (confirmation = "delete-payment")}
              >入金完了日を削除</button
            >{/if}
        </div>
      </fieldset>
    </form>
  </section>
  <section class="panel content-panel" aria-labelledby="pdf-heading">
    <div class="section-heading">
      <h2 id="pdf-heading">正式PDF</h2>
      <a
        href={resolve(
          `/api/invoices/[invoiceNumber]/pdf?revision=${saved.revision}`,
          { invoiceNumber: saved.invoiceNumber },
        )}
        target="_blank"
        rel="noreferrer">PDFを直接開く</a
      >
    </div>
    <iframe title={`${saved.invoiceNumber} の正式PDF`} src={pdfUrl}></iframe>
  </section>
  <section class="panel content-panel" aria-label="請求書の操作">
    {#if saved.paymentCompletedDate !== null}<p class="muted">
        下書きへ戻すには、先に入金完了日を削除してください。
      </p>{/if}
    <button
      type="button"
      disabled={busy || saved.paymentCompletedDate !== null}
      onclick={() => (confirmation = "revert")}>下書きへ戻す</button
    >
  </section>
{/if}

{#if confirmation}
  <ConfirmDialog
    title={confirmation === "delete"
      ? "下書きの削除"
      : confirmation === "revert"
        ? "下書きへ戻す"
        : "入金完了日の削除"}
    confirmLabel={confirmation === "revert" ? "下書きへ戻す" : "削除する"}
    onConfirm={confirmOperation}
    onCancel={() => (confirmation = null)}
  >
    <p>請求書番号：{saved.invoiceNumber}</p>
    {#if confirmation === "delete"}<p>
        下書きを完全に削除します。keiri上では元に戻せません。
      </p>{:else if confirmation === "revert"}<p>
        正式PDFを破棄して下書きへ戻します。
      </p>{:else if saved.paymentCompletedDate}<p>
        入金完了日：{formatBusinessDate(saved.paymentCompletedDate)}
      </p>
      <p>この入金完了日を削除します。</p>{/if}
  </ConfirmDialog>
{/if}

<style>
  .back-link {
    margin: 0 0 1.5rem;
    font-size: 0.875rem;
  }
  h1 {
    overflow-wrap: anywhere;
  }
  h3 {
    font-size: 1rem;
    margin-top: 1.5rem;
  }
  .total-amount {
    font-size: 1.25rem;
    font-weight: 600;
  }
  .totals {
    margin-top: 1.5rem;
  }
  .operation-message {
    color: var(--accent);
  }
  .notes {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .item-name {
    white-space: pre-wrap;
    min-width: 12rem;
    overflow-wrap: anywhere;
  }
  .payment-date {
    max-width: 18rem;
    margin-bottom: 1rem;
  }
  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .section-heading h2 {
    margin: 0;
  }
  iframe {
    display: block;
    width: 100%;
    min-height: 70vh;
    border: 1px solid var(--border);
  }
</style>
