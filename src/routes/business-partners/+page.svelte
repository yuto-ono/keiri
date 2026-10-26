<script lang="ts">
  import { resolve } from "$app/paths";
  import type { PageProps } from "./$types";
  import ReadError from "../../lib/ui/ReadError.svelte";
  import ReloadButton from "../../lib/ui/ReloadButton.svelte";
  let { data }: PageProps = $props();
</script>

<svelte:head><title>取引先 | keiri</title></svelte:head>
{#if data.partners?.ok}
  <header class="page-header">
    <h1>取引先</h1>
    <div class="actions">
      <a
        class="button-link primary"
        href={resolve("/business-partners/new-partner")}
      >
        新規登録
      </a>
      <ReloadButton />
    </div>
  </header>
  {#if data.partners.value.businessPartners.length === 0}
    <p class="panel content-panel muted">取引先は登録されていません。</p>
  {:else}
    <div class="panel table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th scope="col">取引先コード</th>
            <th scope="col">宛名</th>
            <th scope="col">月次請求</th>
          </tr>
        </thead>
        <tbody>
          {#each data.partners.value.businessPartners as partner (partner.code)}
            <tr class="linked-row">
              <td>
                <a
                  href={resolve("/business-partners/[code]", {
                    code: partner.code,
                  })}
                >
                  {partner.code}<span class="row-link" aria-hidden="true"></span>
                </a>
              </td>
              <td class="addressee">{partner.addresseeWithHonorific}</td>
              <td>{partner.requiresMonthlyInvoice ? "対象" : "対象外"}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{:else if data.partners && !data.partners.ok}
  <ReadError error={data.partners.error} />
{/if}

<style>
  .addressee {
    white-space: normal;
    min-width: 12rem;
    overflow-wrap: anywhere;
  }
</style>
