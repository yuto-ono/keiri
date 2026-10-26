<script lang="ts">
  import type { PageProps } from "./$types";
  import InvoiceDetail from "../../../lib/ui/InvoiceDetail.svelte";
  import ReadError from "../../../lib/ui/ReadError.svelte";
  let { data }: PageProps = $props();
</script>

{#if data.detail?.ok}
  {#key data.detail.value.invoice.invoiceNumber}<InvoiceDetail
      detail={data.detail.value}
    />{/key}
{:else if data.detail && !data.detail.ok}<ReadError
    error={data.detail.error}
  />{/if}
