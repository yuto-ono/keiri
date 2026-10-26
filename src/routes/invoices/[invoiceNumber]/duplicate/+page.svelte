<script lang="ts">
  import type { PageProps } from "./$types";
  import InvoiceCreation from "../../../../lib/ui/InvoiceCreation.svelte";
  import ReadError from "../../../../lib/ui/ReadError.svelte";
  let { data }: PageProps = $props();
</script>

{#if data.creation?.ok}{#key data.creation.value.source?.invoiceNumber}<InvoiceCreation
      context={data.creation.value}
    />{/key}{:else if data.creation && !data.creation.ok}<ReadError
    error={data.creation.error}
  />{/if}
