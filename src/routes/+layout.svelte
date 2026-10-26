<script lang="ts">
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import type { LayoutProps } from "./$types";
  import ReadError from "../lib/ui/ReadError.svelte";
  import "#lib/styles/app.css";

  let { data, children }: LayoutProps = $props();
</script>

<svelte:head>
  <title>{data.startupError ? "データ検証エラー | keiri" : "keiri"}</title>
  <meta name="description" content="自分用の経理環境" />
</svelte:head>

{#if data.startupError}
  <main class="startup-error">
    <p class="brand">keiri</p>
    <ReadError error={data.startupError} title="データの検証に失敗しました" />
  </main>
{:else}
  <a class="skip-link" href="#main-content">本文へ移動</a>
  <div class="app-shell">
    <aside>
      <a class="brand" href={resolve("/")}>keiri</a>
      <nav aria-label="メインナビゲーション">
        <a
          href={resolve("/")}
          aria-current={page.url.pathname === resolve("/") ? "page" : undefined}
          >ダッシュボード</a
        >
        <a
          href={resolve("/invoices")}
          aria-current={page.url.pathname === resolve("/invoices") ||
          page.url.pathname.startsWith(`${resolve("/invoices")}/`)
            ? "page"
            : undefined}>請求書</a
        >
        <a
          href={resolve("/business-partners")}
          aria-current={page.url.pathname === resolve("/business-partners") ||
          page.url.pathname.startsWith(`${resolve("/business-partners")}/`)
            ? "page"
            : undefined}>取引先</a
        >
        <span role="link" aria-disabled="true">設定</span>
      </nav>
    </aside>
    <main id="main-content" tabindex="-1">{@render children()}</main>
  </div>
{/if}

<style>
  .app-shell {
    display: grid;
    grid-template-columns: 13rem minmax(0, 1fr);
    min-height: 100vh;
  }
  aside {
    background: var(--surface);
    border-right: 1px solid var(--border);
    padding: 2rem 1rem;
  }
  nav {
    display: grid;
    gap: 0.375rem;
    margin-top: 2.5rem;
  }
  nav :is(a, span) {
    color: var(--text-muted);
    padding: 0.75rem 1rem;
    border-radius: 0.375rem;
    text-decoration: none;
  }
  nav [aria-disabled="true"] {
    opacity: 0.6;
  }
  nav a:hover {
    background: var(--background);
    color: var(--text);
  }
  nav a[aria-current="page"] {
    background: var(--accent-light);
    color: var(--accent);
    font-weight: 600;
  }
  .brand {
    display: block;
    color: var(--text);
    padding: 0 1rem;
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: 0.025em;
    text-decoration: none;
  }
  main {
    min-width: 0;
    max-width: 84rem;
    width: 100%;
    padding: 2.5rem;
  }
  .startup-error {
    max-width: 60rem;
    margin: 0 auto;
  }
  .startup-error .brand {
    margin: 0 0 2rem;
    padding: 0;
  }
  .skip-link {
    position: absolute;
    left: 1rem;
    top: -5rem;
    z-index: 1;
    padding: 1rem;
    background: var(--surface);
  }
  .skip-link:focus {
    top: 1rem;
  }
  @media (max-width: 52rem) {
    .app-shell {
      grid-template-columns: minmax(0, 1fr);
    }
    aside {
      border-right: 0;
      border-bottom: 1px solid var(--border);
      padding: 1rem;
    }
    nav {
      display: flex;
      flex-wrap: wrap;
      margin-top: 1rem;
      gap: 0.25rem;
    }
    nav :is(a, span) {
      padding: 0.625rem 0.75rem;
    }
    .brand {
      padding: 0 0.75rem;
    }
    main {
      padding: 1.5rem 1rem;
    }
  }
</style>
