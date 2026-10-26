<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  let {
    title,
    confirmLabel,
    children,
    onConfirm,
    onCancel,
  }: {
    title: string;
    confirmLabel: string;
    children: Snippet;
    onConfirm: () => void;
    onCancel: () => void;
  } = $props();
  let dialog: HTMLDialogElement;
  let cancelButton: HTMLButtonElement;
  onMount(() => {
    dialog.showModal();
    cancelButton.focus();
    return () => dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="confirmation-heading"
  oncancel={(event) => {
    event.preventDefault();
    onCancel();
  }}
>
  <h2 id="confirmation-heading">{title}</h2>
  <div class="dialog-body">{@render children()}</div>
  <div class="actions">
    <button type="button" bind:this={cancelButton} onclick={onCancel}>
      キャンセル
    </button>
    <button type="button" class="danger" onclick={onConfirm}>
      {confirmLabel}
    </button>
  </div>
</dialog>

<style>
  dialog {
    width: min(32rem, calc(100% - 2rem));
    border: 1px solid var(--border);
    border-radius: 0.625rem;
    padding: 1.5rem;
    color: var(--text);
    background: var(--surface);
  }
  dialog::backdrop {
    background: #14222f66;
  }
  .dialog-body {
    margin: 1.5rem 0;
    overflow-wrap: anywhere;
  }
  .actions {
    justify-content: flex-end;
  }
</style>
