<script lang="ts">
  import type { ApiReadError } from "#lib/ui/read-api";
  import IssueList from "./IssueList.svelte";
  import ReloadButton from "./ReloadButton.svelte";

  let {
    error,
    title = "データを読み込めません",
  }: { error: ApiReadError; title?: string } = $props();
</script>

<section class="panel read-error" role="alert" aria-label={title}>
  <h1>{title}</h1>
  <p>{error.message}</p>
  {#if error.issues.length > 0}
    <IssueList issues={error.issues} />
  {/if}
  <ReloadButton />
</section>

<style>
  .read-error {
    border-color: var(--error-border);
    padding: 1.5rem;
  }
  h1 {
    font-size: 1.5rem;
  }
  p {
    margin: 1rem 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
