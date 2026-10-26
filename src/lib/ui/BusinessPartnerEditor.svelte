<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import {
    createBusinessPartnerForm,
    deleteSavedBusinessPartner,
    loadBusinessPartnerEditor,
    moveBusinessPartnerBank,
    selectBusinessPartnerBank,
    saveBusinessPartnerForm,
    type BusinessPartnerEditorData,
  } from "#lib/ui/business-partner-editor";
  import type { ApiReadError } from "#lib/ui/read-api";
  import { formatBankAccount } from "#lib/ui/format";
  import InlineError from "./InlineError.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";

  let { context }: { context: BusinessPartnerEditorData } = $props();
  const creating = untrack(() => context.businessPartner === null);
  let screen = $state(untrack(() => context));
  let saved = $state(untrack(() => context.businessPartner));
  let form = $state(
    untrack(() =>
      createBusinessPartnerForm(context.businessPartner, context.issuer),
    ),
  );
  let busy = $state(false);
  let deleted = $state(false);
  let confirmDelete = $state(false);
  let operationError = $state<ApiReadError | null>(null);
  let message = $state("");
  let navigationFailed = $state(false);
  let completed = $derived(deleted || (creating && saved !== null));

  async function save() {
    if (busy || completed) return;
    busy = true;
    operationError = null;
    message = "";
    try {
      const result = await saveBusinessPartnerForm(
        fetch,
        saved,
        form,
        screen.issuer,
      );
      if (!result.ok) {
        operationError = result.error;
        return;
      }
      const previousCode = saved?.code;
      saved = result.value.businessPartner;
      form = createBusinessPartnerForm(saved, screen.issuer);
      message = "保存しました。";
      if (previousCode !== saved.code) {
        try {
          await goto(
            resolve("/business-partners/[code]", { code: saved.code }),
            { refreshAll: true },
          );
        } catch {
          navigationFailed = true;
        }
      }
    } finally {
      busy = false;
    }
  }

  async function reload() {
    if (busy || saved === null || completed) return;
    busy = true;
    operationError = null;
    message = "";
    try {
      const result = await loadBusinessPartnerEditor(fetch, saved.code);
      if (!result.ok) {
        operationError = result.error;
        return;
      }
      screen = result.value;
      saved = screen.businessPartner;
      form = createBusinessPartnerForm(saved, screen.issuer);
      message = "最新のデータを読み直しました。";
    } finally {
      busy = false;
    }
  }

  async function remove() {
    confirmDelete = false;
    if (busy || saved === null || completed || screen.hasInvoiceReferences)
      return;
    busy = true;
    operationError = null;
    message = "";
    try {
      const result = await deleteSavedBusinessPartner(fetch, saved);
      if (!result.ok) {
        operationError = result.error;
        return;
      }
      deleted = true;
      message = "取引先を削除しました。";
      try {
        await goto(resolve("/business-partners"), { refreshAll: true });
      } catch {
        navigationFailed = true;
      }
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head
  ><title
    >{creating ? "取引先の新規登録" : `${saved?.code} の取引先詳細`} | keiri</title
  ></svelte:head
>
<p class="back-link">
  <a href={resolve("/business-partners")}>取引先一覧へ</a>
</p>
<header class="page-header">
  <div>
    <h1>{creating ? "取引先の新規登録" : saved?.code}</h1>
    <p>{saved ? `リビジョン ${saved.revision}` : "未保存"}</p>
  </div>
  {#if !completed}
    {#if creating}
      <a
        class="button-link"
        href={resolve("/business-partners")}
        aria-disabled={busy}
        onclick={(event) => {
          if (busy) event.preventDefault();
        }}>キャンセル</a
      >
    {:else}
      <button type="button" disabled={busy} onclick={reload}
        >最新のデータを読み直す</button
      >
    {/if}
  {/if}
</header>
{#if !creating && !completed}<p class="muted">
    読み直すと、未保存の入力内容は破棄されます。
  </p>{/if}
{#if operationError}<InlineError error={operationError} focus={true} />{/if}
{#if message}<p class="operation-message" role="status">{message}</p>{/if}
{#if navigationFailed}
  <section class="panel content-panel" role="status">
    <p>画面を移動できませんでした。</p>
    {#if deleted}<a href={resolve("/business-partners")}>取引先一覧を開く</a>
    {:else if saved}<a
        href={resolve("/business-partners/[code]", { code: saved.code })}
        >保存した取引先を開く</a
      >{/if}
  </section>
{/if}
<form
  onsubmit={(event) => {
    event.preventDefault();
    void save();
  }}
>
  <fieldset disabled={busy || completed}>
    <section class="panel content-panel" aria-labelledby="partner-heading">
      <h2 id="partner-heading">基本情報</h2>
      {#if saved && screen.hasInvoiceReferences}
        <dl class="details-grid">
          <div>
            <dt>取引先コード</dt>
            <dd>{saved.code}</dd>
          </div>
        </dl>
        <p class="muted">
          請求書から参照されているため、コードは変更できません。
        </p>
      {:else}
        <label
          >取引先コード<input
            type="text"
            required
            minlength="1"
            maxlength="12"
            pattern={"[A-Za-z0-9]{1,12}"}
            bind:value={form.code}
          /><span class="field-help"
            >1〜12文字の半角英数字。大文字・小文字を区別せず一意にします。</span
          ></label
        >
      {/if}
      <div class="form-grid">
        <label
          >宛名本体<input
            type="text"
            required
            bind:value={form.addressee}
          /></label
        >
        <label
          >敬称<select required bind:value={form.honorific}
            ><option value="" disabled>選択してください</option><option
              value="御中">御中</option
            ><option value="様">様</option></select
          ></label
        >
        <label
          >月次請求<select required bind:value={form.requiresMonthlyInvoice}
            ><option value="" disabled>選択してください</option><option
              value="yes">対象</option
            ><option value="no">対象外</option></select
          ></label
        >
        <label
          >明細単価の初期値<select
            required
            bind:value={form.unitPricesIncludeTax}
            ><option value="" disabled>選択してください</option><option
              value="no">税抜</option
            ><option value="yes">税込</option></select
          ></label
        >
      </div>
      <label
        >請求指示（任意）<textarea
          rows="6"
          bind:value={form.billingInstructions}></textarea><span
          class="field-help"
          >契約内容、請求方法、支払期限などの指示を自由に記載できます。</span
        ></label
      >
    </section>
    <section
      class="panel content-panel"
      aria-labelledby="issuer-display-heading"
    >
      <h2 id="issuer-display-heading">発行者情報の表示</h2>
      <p>{screen.issuer.name}</p>
      <div class="contact-choices">
        <label class="checkbox-label"
          ><input
            type="checkbox"
            disabled={screen.issuer.phone === null}
            bind:checked={form.showPhone}
          />電話番号をPDFに表示（{screen.issuer.phone ?? "未登録"}）</label
        >
        <label class="checkbox-label"
          ><input
            type="checkbox"
            disabled={screen.issuer.email === null}
            bind:checked={form.showEmail}
          />メールアドレスをPDFに表示（{screen.issuer.email ??
            "未登録"}）</label
        >
      </div>
      <p class="muted">
        宛名・敬称・単価の初期値・発行者情報の変更は、新しく作成する下書きから反映されます。
      </p>
    </section>
    <section class="panel content-panel" aria-labelledby="bank-heading">
      <h2 id="bank-heading">振込先</h2>
      <p class="muted">PDFに表示する振込先を1件以上選択してください。</p>
      <div class="bank-choices">
        {#each screen.issuer.bankAccounts as account (account.id)}
          <label class="checkbox-label"
            ><input
              type="checkbox"
              checked={form.bankAccountIds.includes(account.id)}
              onchange={(event) =>
                (form.bankAccountIds = selectBusinessPartnerBank(
                  form.bankAccountIds,
                  account.id,
                  event.currentTarget.checked,
                ))}
            />{formatBankAccount(account)}</label
          >
        {/each}
      </div>
      <h3>表示順</h3>
      {#if form.bankAccountIds.length === 0}<p class="muted">
          振込先は選択されていません。
        </p>{/if}
      <ol class="bank-order">
        {#each form.bankAccountIds as id, index (id)}
          <li>
            <span
              >{screen.issuer.bankAccounts.find((account) => account.id === id)
                ?.bankName} / {screen.issuer.bankAccounts.find(
                (account) => account.id === id,
              )?.branchName}</span
            >
            <div class="actions">
              <button
                type="button"
                disabled={index === 0}
                aria-label={`振込先${index + 1}を上へ`}
                onclick={() =>
                  (form.bankAccountIds = moveBusinessPartnerBank(
                    form.bankAccountIds,
                    index,
                    -1,
                  ))}>上へ</button
              >
              <button
                type="button"
                disabled={index === form.bankAccountIds.length - 1}
                aria-label={`振込先${index + 1}を下へ`}
                onclick={() =>
                  (form.bankAccountIds = moveBusinessPartnerBank(
                    form.bankAccountIds,
                    index,
                    1,
                  ))}>下へ</button
              >
            </div>
          </li>
        {/each}
      </ol>
    </section>
    <section class="panel content-panel" aria-labelledby="pdf-name-heading">
      <h2 id="pdf-name-heading">PDFファイル名</h2>
      <label
        >命名規則<input
          type="text"
          required
          bind:value={form.pdfFileNamePattern}
        /><span class="field-help">拡張子 .pdf は自動で追加します。</span
        ></label
      >
      <p class="muted">使用できる差し込み：</p>
      <ul class="pattern-help">
        <li><code>{"{businessPartnerCode}"}</code>：取引先コード</li>
        <li><code>{"{addresseeWithHonorific}"}</code>：敬称を含む宛名</li>
        <li>
          <code>{"{issueDate:YYYYMM}"}</code
          >：発行日（YYYY・MM・DDを使用できます）
        </li>
        <li><code>{"{sequence}"}</code>：2桁の連番</li>
      </ul>
      <p class="muted">
        命名規則の変更は、既存の下書きも含め、次に発行するPDFから適用されます。
      </p>
    </section>
    <div class="actions">
      <button type="submit" class="primary"
        >{busy ? "処理中…" : "保存する"}</button
      >
    </div>
  </fieldset>
</form>
{#if !creating && saved && !completed}
  <section
    class="panel content-panel delete-section"
    aria-labelledby="delete-heading"
  >
    <h2 id="delete-heading">取引先の削除</h2>
    {#if screen.hasInvoiceReferences}<p class="muted">
        請求書から参照されている取引先は削除できません。
      </p>{/if}
    <button
      type="button"
      class="danger"
      disabled={busy || screen.hasInvoiceReferences}
      onclick={() => (confirmDelete = true)}>取引先を削除</button
    >
  </section>
{/if}
{#if confirmDelete && saved}
  <ConfirmDialog
    title="取引先の削除"
    confirmLabel="削除する"
    onConfirm={remove}
    onCancel={() => (confirmDelete = false)}
  >
    <p>取引先コード：{saved.code}</p>
    <p>宛名：{saved.addressee}{saved.honorific}</p>
    <p>保存済みの取引先を完全に削除します。keiri上では元に戻せません。</p>
  </ConfirmDialog>
{/if}

<style>
  .back-link {
    margin: 0 0 1.5rem;
    font-size: 0.875rem;
  }
  h1 {
    overflow-wrap: anywhere;
  }
  h3 {
    font-size: 1rem;
  }
  .form-grid {
    margin: 1.5rem 0;
  }
  .contact-choices,
  .bank-choices {
    display: grid;
    gap: 1rem;
    margin: 1.5rem 0;
  }
  .bank-order {
    padding-left: 1.5rem;
  }
  .bank-order li {
    padding: 0.5rem 0;
  }
  .bank-order li span {
    display: block;
    margin-bottom: 0.5rem;
  }
  .pattern-help {
    font-size: 0.875rem;
    padding-left: 1.5rem;
    overflow-wrap: anywhere;
  }
  .pattern-help li + li {
    margin-top: 0.5rem;
  }
  .delete-section {
    margin-top: 2rem;
  }
  .operation-message {
    color: var(--accent);
  }
</style>
