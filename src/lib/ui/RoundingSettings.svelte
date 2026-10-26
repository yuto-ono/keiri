<script lang="ts">
  import { untrack } from "svelte";
  import type { Settings } from "#lib/domain/model";
  import {
    createRoundingForm,
    saveRoundingForm,
  } from "#lib/ui/settings-editor";
  import { formatRoundingMethod } from "#lib/ui/format";
  import { readJsonApi, type ApiReadError } from "#lib/ui/read-api";
  import InlineError from "./InlineError.svelte";
  let { settings }: { settings: Settings } = $props();
  let saved = $state(untrack(() => settings));
  let form = $state(untrack(() => createRoundingForm(settings)));
  let busy = $state(false);
  let operationError = $state<ApiReadError | null>(null);
  let message = $state("");
  const methods = ["floor", "halfUp", "ceil"] as const;

  async function change(reload: boolean) {
    if (busy) return;
    busy = true;
    operationError = null;
    message = "";
    try {
      const result = reload
        ? await readJsonApi<{ settings: Settings }>(fetch, "/api/settings")
        : await saveRoundingForm(fetch, saved, form);
      if (!result.ok) {
        operationError = result.error;
        return;
      }
      saved = result.value.settings;
      form = createRoundingForm(saved);
      message = reload
        ? "端数処理の最新データを読み直しました。"
        : "端数処理を保存しました。";
    } finally {
      busy = false;
    }
  }
</script>

<section
  class="panel content-panel"
  aria-labelledby="rounding-settings-heading"
>
  <h2 id="rounding-settings-heading">端数処理</h2>
  <p class="muted">リビジョン {saved.revision}</p>
  {#if operationError}<InlineError error={operationError} focus={true} />{/if}
  {#if message}<p class="operation-message" role="status">{message}</p>{/if}
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void change(false);
    }}
  >
    <fieldset disabled={busy}>
      <div class="form-grid">
        <label
          >明細金額<select required bind:value={form.lineAmount}
            >{#each methods as method (method)}<option value={method}
                >{formatRoundingMethod(method)}</option
              >{/each}</select
          ></label
        >
        <label
          >消費税額<select required bind:value={form.taxAmount}
            >{#each methods as method (method)}<option value={method}
                >{formatRoundingMethod(method)}</option
              >{/each}</select
          ></label
        >
      </div>
      <p class="muted">変更は新しく作成する下書きから反映されます。</p>
      <div class="actions">
        <button type="submit" class="primary">端数処理を保存</button>
        <button type="button" onclick={() => change(true)}
          >端数処理の最新データを読み直す</button
        >
      </div>
      <p class="field-help">
        読み直すと、端数処理の未保存の入力内容は破棄されます。
      </p>
    </fieldset>
  </form>
</section>

<style>
  .operation-message {
    color: var(--accent);
  }
</style>
