<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import type { ApiReadError } from "#lib/ui/read-api";
  import {
    changeUnsavedInvoicePartner,
    createUnsavedInvoiceForm,
    getUnsavedInvoiceFieldContext,
    getUnsavedIssuerSnapshot,
    previewUnsavedInvoice,
    saveUnsavedInvoice,
    type InvoiceCreationScreenData,
  } from "#lib/ui/invoice-creation";
  import { formatRoundingMethod, formatYen } from "#lib/ui/format";
  import InvoiceDraftFields from "./InvoiceDraftFields.svelte";
  import InvoiceIssuer from "./InvoiceIssuer.svelte";
  import InlineError from "./InlineError.svelte";

  let { context }: { context: InvoiceCreationScreenData } = $props();
  const initial = untrack(() => context);
  const source = initial.source;
  let form = $state(untrack(() => createUnsavedInvoiceForm(context)));
  let busy = $state(false);
  let savedInvoiceNumber = $state<string | null>(null);
  let operationError = $state<ApiReadError | null>(null);
  let navigationFailed = $state(false);
  let preview = $derived(previewUnsavedInvoice(form, initial));

  async function save() {
    if (busy || savedInvoiceNumber !== null) return;
    busy = true;
    operationError = null;
    try {
      const result = await saveUnsavedInvoice(fetch, form, initial);
      if (!result.ok) {
        operationError = result.error;
        return;
      }
      savedInvoiceNumber = result.value.invoice.invoiceNumber;
      try {
        await goto(
          resolve("/invoices/[invoiceNumber]", {
            invoiceNumber: savedInvoiceNumber,
          }),
          { refreshAll: true },
        );
      } catch {
        navigationFailed = true;
      }
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head
  ><title>{source === null ? "請求書の新規作成" : "請求書の複製"} | keiri</title
  ></svelte:head
>
<header class="page-header">
  <div>
    <h1>{source === null ? "請求書の新規作成" : "請求書の複製"}</h1>
    <p class="muted">{savedInvoiceNumber === null ? "未保存" : "保存済み"}</p>
  </div>
  {#if savedInvoiceNumber === null}<a
      class="button-link"
      href={source === null
        ? resolve("/invoices")
        : resolve("/invoices/[invoiceNumber]", {
            invoiceNumber: source.invoiceNumber,
          })}
      aria-disabled={busy}
      onclick={(event) => {
        if (busy) event.preventDefault();
      }}>キャンセル</a
    >{/if}
</header>
{#if source}<p>
    複製元：<a
      href={resolve("/invoices/[invoiceNumber]", {
        invoiceNumber: source.invoiceNumber,
      })}>{source.invoiceNumber}</a
    >
  </p>{/if}
{#if operationError}<InlineError error={operationError} focus={true} />{/if}
{#if savedInvoiceNumber}
  <section class="panel content-panel" role="status">
    <h2>保存しました</h2>
    <p>請求書番号：{savedInvoiceNumber}</p>
    {#if navigationFailed}<p>
        詳細画面へ移動できませんでした。保存した請求書を開いてください。
      </p>{/if}<a
      href={resolve("/invoices/[invoiceNumber]", {
        invoiceNumber: savedInvoiceNumber,
      })}>保存した請求書を開く</a
    >
  </section>
{/if}
<form
  onsubmit={(event) => {
    event.preventDefault();
    void save();
  }}
>
  <fieldset disabled={busy || savedInvoiceNumber !== null}>
    <section
      class="panel content-panel"
      aria-labelledby="partner-selection-heading"
    >
      <h2 id="partner-selection-heading">取引先</h2>
      <label
        >取引先<select
          required
          value={form.businessPartnerCode}
          onchange={(event) =>
            (form = changeUnsavedInvoicePartner(
              form,
              event.currentTarget.value,
              initial,
            ))}
          ><option value="">選択してください</option
          >{#each initial.businessPartners as partner (partner.code)}<option
              value={partner.code}
              >{partner.code} / {partner.addressee}{partner.honorific}</option
            >{/each}</select
        ></label
      >
      {#if initial.businessPartners.length === 0}<p class="muted">
          取引先が登録されていません。請求書を保存するには取引先の登録が必要です。
        </p>{/if}
    </section>
    <InvoiceDraftFields
      bind:form
      context={getUnsavedInvoiceFieldContext(form, initial)}
      calculation={preview.ok ? preview.value : null}
    />
    <InvoiceIssuer
      snapshot={getUnsavedIssuerSnapshot(form, initial)}
      showBanks={false}
    />
    <section
      class="panel content-panel"
      aria-labelledby="invoice-total-heading"
    >
      <h2 id="invoice-total-heading">請求金額</h2>
      <dl class="details-grid">
        <div>
          <dt>税抜額</dt>
          <dd>{preview.ok ? formatYen(preview.value.taxableAmount) : "—"}</dd>
        </div>
        <div>
          <dt>消費税額</dt>
          <dd>{preview.ok ? formatYen(preview.value.taxAmount) : "—"}</dd>
        </div>
        <div>
          <dt>請求合計</dt>
          <dd class="total-amount">
            {preview.ok ? formatYen(preview.value.totalAmount) : "—"}
          </dd>
        </div>
      </dl>
      <p class="muted">
        明細金額：{formatRoundingMethod(initial.rounding.lineAmount)} / 消費税額：{formatRoundingMethod(
          initial.rounding.taxAmount,
        )}
      </p>
      <p class="muted">保存時に請求書番号を採番します。</p>
      <div class="actions">
        <button type="submit" class="primary"
          >{busy ? "保存中…" : "保存する"}</button
        >
      </div>
    </section>
  </fieldset>
</form>

<style>
  .total-amount {
    font-weight: 600;
    font-size: 1.25rem;
  }
</style>
