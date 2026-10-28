<script lang="ts">
  import type { Toast } from "#lib/ui/toast.svelte";

  let { toast, onDismiss }: { toast: Toast; onDismiss: () => void } = $props();
  let hovered = $state(false);
  let focused = $state(false);

  $effect(() => {
    if (hovered || focused) return;
    const timer = setTimeout(() => onDismiss(), 5000);
    return () => clearTimeout(timer);
  });
</script>

<div
  class="toast"
  role="group"
  aria-label="操作結果"
  onpointerenter={() => (hovered = true)}
  onpointerleave={() => (hovered = false)}
  onfocusin={() => (focused = true)}
  onfocusout={() => (focused = false)}
>
  <span class="success-mark" aria-hidden="true">✓</span>
  <p>{toast.message}</p>
  <button type="button" aria-label="通知を閉じる" onclick={onDismiss}>×</button>
</div>

<style>
  .toast {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 1rem;
    border: 1px solid #86c79e;
    border-radius: 0.625rem;
    background: #f0fdf4;
    color: #166534;
    box-shadow: 0 0.375rem 1.5rem #1665341f;
    pointer-events: auto;
    animation: toast-enter 200ms ease-out;
  }
  .success-mark {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    background: #15803d;
    color: #fff;
    font-size: 0.875rem;
    font-weight: 700;
  }
  p {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  button {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    margin: -0.25rem;
    padding: 0;
    border-color: transparent;
    background: transparent;
    color: #166534;
    font-size: 1.25rem;
  }
  button:hover:enabled {
    background: #dcfce7;
    border-color: #86c79e;
  }
  button:focus-visible {
    outline-color: #15803d;
  }
  @keyframes toast-enter {
    from {
      opacity: 0;
      transform: translateY(0.75rem);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .toast {
      animation: none;
    }
  }
</style>
