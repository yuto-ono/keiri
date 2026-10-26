<script lang="ts">
  import { onMount } from "svelte";
  import type { ApiReadError } from "#lib/ui/read-api";
  import IssueList from "./IssueList.svelte";
  let { error, focus = false }: { error: ApiReadError; focus?: boolean } =
    $props();
  let element: HTMLDivElement;
  onMount(() => {
    if (focus) element.focus();
  });
</script>

<div class="inline-error" role="alert" bind:this={element} tabindex="-1">
  <p>{error.message}</p>
  {#if error.issues.length}<IssueList issues={error.issues} />{/if}
</div>

<style>
  .inline-error {
    border: 1px solid var(--error-border);
    border-radius: 0.375rem;
    padding: 1rem;
    margin: 1rem 0;
    color: var(--error);
    background: #fff8f7;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
    white-space: pre-wrap;
  }
</style>
