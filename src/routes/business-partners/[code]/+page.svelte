<script lang="ts">
  import type { PageProps } from "./$types";
  import BusinessPartnerEditor from "../../../lib/ui/BusinessPartnerEditor.svelte";
  import ReadError from "../../../lib/ui/ReadError.svelte";
  let { data }: PageProps = $props();
</script>

{#if data.editor?.ok}
  {#key data.editor.value.businessPartner?.code}
    <BusinessPartnerEditor context={data.editor.value} />
  {/key}
{:else if data.editor && !data.editor.ok}
  <ReadError error={data.editor.error} />
{/if}
