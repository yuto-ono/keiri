<script lang="ts">
  import { getToasts } from "#lib/ui/toast.svelte";
  import ToastMessage from "./ToastMessage.svelte";

  const toasts = getToasts();
</script>

<div
  class="toast-region"
  role="status"
  aria-label="操作結果の通知"
  aria-atomic="false"
  aria-relevant="additions"
>
  {#each toasts.messages as toast (toast.id)}
    <ToastMessage {toast} onDismiss={() => toasts.dismiss(toast.id)} />
  {/each}
</div>

<style>
  .toast-region {
    position: fixed;
    right: 1.5rem;
    bottom: 1.5rem;
    z-index: 10;
    display: grid;
    gap: 0.75rem;
    width: min(26rem, calc(100% - 3rem));
    max-height: calc(100dvh - 3rem);
    overflow-y: auto;
    padding: 0.25rem;
    pointer-events: none;
  }
  @media (max-width: 40rem) {
    .toast-region {
      right: 0.75rem;
      bottom: 0.75rem;
      width: calc(100% - 1.5rem);
      max-height: calc(100dvh - 1.5rem);
    }
  }
</style>
