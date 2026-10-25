<script lang="ts">
  import "#lib/styles/app.css";

  let { children } = $props();
</script>

<svelte:head>
  <title>keiri</title>
  <meta name="description" content="自分用の経理環境" />
</svelte:head>

{@render children()}
