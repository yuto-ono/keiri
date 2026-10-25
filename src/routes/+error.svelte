<script lang="ts">
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import ReloadButton from "../lib/ui/ReloadButton.svelte";
</script>

<svelte:head><title>エラー | keiri</title></svelte:head>

<section class="panel" role="alert">
  <h1>
    {page.status === 404 ? "ページが見つかりません" : "画面を表示できません"}
  </h1>
  <p>
    {page.status === 404
      ? "URLを確認してください。"
      : "読み込み中にエラーが発生しました。再読み込みしてください。"}
  </p>
  {#if page.status !== 404}<ReloadButton />{/if}
  <p><a href={resolve("/")}>ダッシュボードへ戻る</a></p>
</section>

<style>
  section {
    padding: 1.5rem;
  }
  h1 {
    font-size: 1.5rem;
  }
  p {
    margin: 1rem 0;
  }
</style>
