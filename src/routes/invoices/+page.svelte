<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import type { PageProps } from "./$types";
  import {
    formatBusinessDate,
    formatBusinessMonth,
  } from "#lib/domain/business-date";
  import { formatYen } from "#lib/ui/format";
  import ReadError from "../../lib/ui/ReadError.svelte";
  import ReloadButton from "../../lib/ui/ReloadButton.svelte";
  let { data }: PageProps = $props();
</script>

<svelte:head><title>請求書 | keiri</title></svelte:head>
{#if data.invoices?.ok}
  {@const result = data.invoices.value}
  <header class="page-header">
    <h1>請求書</h1>
    <div class="actions">
      <a class="button-link primary" href={resolve("/invoices/new")}>新規作成</a>
      <ReloadButton />
    </div>
  </header>
  <label class="year-select">
    請求年
    <select
      value={result.year}
      onchange={(event) =>
        goto(resolve(`/invoices?year=${event.currentTarget.value}`))}
    >
      {#each result.years as year (year)}
        <option value={year}>{year}年</option>
      {/each}
    </select>
  </label>
  {#if result.months.length === 0}
    <p class="panel content-panel muted">この請求年の請求書はありません。</p>
  {/if}
  {#each result.months as group (group.month)}
    <section class="month-group" aria-label={formatBusinessMonth(group.month)}>
      <h2>{formatBusinessMonth(group.month)}</h2>
      <div class="panel table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">請求日</th>
              <th scope="col">請求書番号</th>
              <th scope="col">宛名</th>
              <th scope="col">支払期限</th>
              <th scope="col" class="amount">請求合計</th>
              <th scope="col">状態</th>
              <th scope="col">入金状況</th>
            </tr>
          </thead>
          <tbody>
            {#each group.invoices as invoice (invoice.invoiceNumber)}
              <tr class="linked-row">
                <td>
                  <time datetime={invoice.invoiceDate}>
                    {formatBusinessDate(invoice.invoiceDate)}
                  </time>
                </td>
                <td>
                  <a
                    href={resolve("/invoices/[invoiceNumber]", {
                      invoiceNumber: invoice.invoiceNumber,
                    })}
                  >
                    {invoice.invoiceNumber}<span class="row-link" aria-hidden="true"></span>
                  </a>
                </td>
                <td class="addressee">{invoice.addresseeWithHonorific}</td>
                <td>
                  <time datetime={invoice.paymentDueDate}>
                    {formatBusinessDate(invoice.paymentDueDate)}
                  </time>
                </td>
                <td class="amount">{formatYen(invoice.totalAmount)}</td>
                <td>{invoice.status === "draft" ? "下書き" : "発行済み"}</td>
                <td>
                  {#if invoice.status === "draft"}
                    —
                  {:else if invoice.paymentCompletedDate}
                    <time datetime={invoice.paymentCompletedDate}>
                      {formatBusinessDate(invoice.paymentCompletedDate)}
                    </time>
                  {:else}
                    入金未確認
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/each}
{:else if data.invoices && !data.invoices.ok}
  <ReadError error={data.invoices.error} />
{/if}

<style>
  .year-select {
    max-width: 12rem;
    margin-bottom: 2rem;
  }
  .month-group + .month-group {
    margin-top: 2rem;
  }
  .addressee {
    white-space: normal;
    min-width: 12rem;
    overflow-wrap: anywhere;
  }
</style>
