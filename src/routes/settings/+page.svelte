<script lang="ts">
  import type { PageProps } from "./$types";
  import IssuerSettings from "../../lib/ui/IssuerSettings.svelte";
  import RoundingSettings from "../../lib/ui/RoundingSettings.svelte";
  import ReadError from "../../lib/ui/ReadError.svelte";
  let { data }: PageProps = $props();
</script>

<svelte:head><title>設定 | keiri</title></svelte:head>
{#if data.settingsScreen?.ok}
  <header class="page-header"><h1>設定</h1></header>
  <IssuerSettings issuer={data.settingsScreen.value.issuer} />
  <RoundingSettings settings={data.settingsScreen.value.settings} />
{:else if data.settingsScreen && !data.settingsScreen.ok}
  <ReadError error={data.settingsScreen.error} />
{/if}
