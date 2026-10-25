<script lang="ts">
  import type { PageProps } from "./$types";
  import {
    formatBusinessDate,
    formatBusinessMonth,
  } from "#lib/domain/business-date";
  import { formatYen } from "#lib/ui/format";
  import IssueList from "../lib/ui/IssueList.svelte";
  import ReadError from "../lib/ui/ReadError.svelte";
  import ReloadButton from "../lib/ui/ReloadButton.svelte";

  let { data }: PageProps = $props();
</script>

<svelte:head><title>ダッシュボード | keiri</title></svelte:head>

{#if data.dashboard?.ok}
  {@const dashboard = data.dashboard.value}
  <header class="page-header">
    <div>
      <h1>ダッシュボード</h1>
      <p class="muted">
        <time datetime={dashboard.today}
          >{formatBusinessDate(dashboard.today)}</time
        >
      </p>
    </div>
    <ReloadButton />
  </header>

  <section aria-labelledby="monthly-billing-heading">
    <h2 id="monthly-billing-heading">月次請求</h2>
    <div class="monthly-records">
      {#each dashboard.monthlyBilling as entry, index (entry.month)}
        <article class="panel monthly-record">
          <header class="record-header">
            <div>
              <p class="eyebrow">{index === 0 ? "今月" : "先月"}</p>
              <h3>{formatBusinessMonth(entry.month)}</h3>
            </div>
            {#if entry.kind === "error"}
              <span class="status status-error">判定エラー</span>
            {:else if entry.kind === "recorded" && entry.status === "completed"}
              <span class="status status-completed">完了</span>
            {:else}
              <span class="status status-pending">未完了</span>
            {/if}
          </header>
          <p class="file-path"><code>{entry.filePath}</code></p>
          {#if entry.kind === "missing"}
            <p class="empty-record">記録なし</p>
          {:else}
            {#if entry.kind === "error"}
              <div class="monthly-error" role="alert">
                <IssueList issues={entry.issues} filePath={entry.filePath} />
              </div>
            {/if}
            <pre class="monthly-body">{entry.body}</pre>
          {/if}
        </article>
      {/each}
    </div>
  </section>

  <section class="overdue" aria-labelledby="overdue-heading">
    <h2 id="overdue-heading">要対応</h2>
    <div class="panel">
      {#if dashboard.overdueInvoices.length === 0}
        <p class="empty-invoices">
          支払期限を過ぎた入金未確認の請求書はありません。
        </p>
      {:else}
        <div class="table-scroll">
          <table>
            <thead
              ><tr
                ><th scope="col">支払期限</th><th scope="col">請求書番号</th><th
                  scope="col">宛名</th
                ><th scope="col" class="amount">請求合計</th></tr
              ></thead
            >
            <tbody>
              {#each dashboard.overdueInvoices as invoice (invoice.invoiceNumber)}
                <tr>
                  <td
                    ><time datetime={invoice.paymentDueDate}
                      >{formatBusinessDate(invoice.paymentDueDate)}</time
                    ></td
                  >
                  <td>{invoice.invoiceNumber}</td>
                  <td class="addressee">{invoice.addresseeWithHonorific}</td>
                  <td class="amount">{formatYen(invoice.totalAmount)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </section>
{:else if data.dashboard && !data.dashboard.ok}
  <ReadError error={data.dashboard.error} />
{/if}

<style>
  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 2.5rem;
  }
  .page-header p {
    margin: 0.5rem 0 0;
    font-size: 0.875rem;
  }
  .monthly-records {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.25rem;
  }
  .monthly-record {
    padding: 1.5rem;
  }
  .record-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 1rem;
  }
  .eyebrow {
    margin: 0 0 0.25rem;
    color: var(--text-muted);
    font-size: 0.75rem;
  }
  .file-path {
    margin: 1rem 0;
    color: var(--text-muted);
    font-size: 0.75rem;
    overflow-wrap: anywhere;
  }
  .status {
    display: inline-flex;
    border: 1px solid;
    border-radius: 0.25rem;
    padding: 0.25rem 0.625rem;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .status-pending {
    color: var(--text-muted);
    border-color: var(--border);
    background: var(--background);
  }
  .status-completed {
    color: #166347;
    border-color: #b5dbc9;
    background: #eef8f2;
  }
  .status-error {
    color: var(--error);
    border-color: var(--error-border);
    background: #fff5f3;
  }
  .monthly-error {
    color: var(--error);
    font-size: 0.875rem;
  }
  .monthly-body {
    margin: 1rem 0 0;
    font: inherit;
    line-height: 1.8;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .empty-record {
    margin: 2rem 0;
    color: var(--text-muted);
  }
  .overdue {
    margin-top: 2.5rem;
  }
  .empty-invoices {
    margin: 0;
    padding: 2rem 1.5rem;
    color: var(--text-muted);
  }
  .table-scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.875rem;
  }
  th,
  td {
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border);
    text-align: left;
  }
  th {
    font-weight: 500;
    color: var(--text-muted);
    background: #fafbfc;
  }
  td {
    white-space: nowrap;
  }
  td.addressee {
    min-width: 10rem;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .amount {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  tbody tr:last-child td {
    border-bottom: 0;
  }
  @media (max-width: 70rem) {
    .monthly-records {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
