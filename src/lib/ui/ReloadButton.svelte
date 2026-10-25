<script lang="ts">
  import { invalidateAll } from "$app/navigation";

  let loading = $state(false);
  let failed = $state(false);

  async function reload() {
    if (loading) return;
    loading = true;
    failed = false;
    try {
      await invalidateAll();
    } catch {
      failed = true;
    } finally {
      loading = false;
    }
  }
</script>

<div>
  <button type="button" disabled={loading} onclick={reload}>
    {loading ? "読み込み中…" : "再読み込み"}
  </button>
  {#if failed}<p role="alert">
      再読み込みに失敗しました。もう一度お試しください。
    </p>{/if}
</div>
