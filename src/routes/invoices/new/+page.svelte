<script lang="ts">
  import type { PageProps } from "./$types";
  import InvoiceCreation from "../../../lib/ui/InvoiceCreation.svelte";
  import ReadError from "../../../lib/ui/ReadError.svelte";
  let { data }: PageProps = $props();
</script>

{#if data.creation?.ok}
  <InvoiceCreation context={data.creation.value} />
{:else if data.creation && !data.creation.ok}
  <ReadError error={data.creation.error} />
{/if}
