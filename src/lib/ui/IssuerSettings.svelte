<script lang="ts">
  import { untrack } from "svelte";
  import type { Issuer } from "#lib/domain/model";
  import {
    appendIssuerBankAccount,
    createIssuerForm,
    issuerApiPath,
    saveIssuerForm,
  } from "#lib/ui/settings-editor";
  import { readJsonApi, type ApiReadError } from "#lib/ui/read-api";
  import InlineError from "./InlineError.svelte";
  let { issuer }: { issuer: Issuer } = $props();
  let saved = $state(untrack(() => issuer));
  let form = $state(untrack(() => createIssuerForm(issuer)));
  let busy = $state(false);
  let operationError = $state<ApiReadError | null>(null);
  let message = $state("");

  async function change(reload: boolean) {
    if (busy) return;
    busy = true;
    operationError = null;
    message = "";
    try {
      const result = reload
        ? await readJsonApi<{ issuer: Issuer }>(fetch, issuerApiPath(saved.id))
        : await saveIssuerForm(fetch, saved, form);
      if (!result.ok) {
        operationError = result.error;
        return;
      }
      saved = result.value.issuer;
      form = createIssuerForm(saved);
      message = reload
        ? "発行者の最新データを読み直しました。"
        : "発行者を保存しました。";
    } finally {
      busy = false;
    }
  }
</script>

<section class="panel content-panel" aria-labelledby="issuer-settings-heading">
  <h2 id="issuer-settings-heading">発行者</h2>
  <p class="muted">リビジョン {saved.revision}</p>
  <dl class="details-grid">
    <div>
      <dt>発行者ID</dt>
      <dd>{saved.id}</dd>
    </div>
  </dl>
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
          >氏名または名称<input
            type="text"
            required
            bind:value={form.name}
          /></label
        >
        <label
          >登録番号<input
            type="text"
            required
            minlength="14"
            maxlength="14"
            pattern={"T[0-9]{13}"}
            bind:value={form.registrationNumber}
          /><span class="field-help"
            >半角大文字Tと13桁の半角数字で入力してください。</span
          ></label
        >
        <label
          >電話番号（任意）<input type="text" bind:value={form.phone} /></label
        >
        <label
          >メールアドレス（任意）<input
            type="text"
            bind:value={form.email}
          /></label
        >
      </div>
      <p class="muted">
        取引先が表示対象にしている連絡先は、先に取引先の表示設定を変更するまで削除できません。
      </p>
      <div class="section-heading">
        <h3>振込先</h3>
        <button
          type="button"
          onclick={() => (form = appendIssuerBankAccount(form))}
          >振込先を追加</button
        >
      </div>
      {#each form.bankAccounts as account, index (account.key)}
        <fieldset class="bank-account">
          <legend>振込先 {index + 1}</legend>
          {#if account.savedId !== null}
            <dl class="details-grid">
              <div>
                <dt>振込先ID</dt>
                <dd>{account.savedId}</dd>
              </div>
            </dl>
          {:else}
            <label
              >振込先ID<input
                type="text"
                required
                maxlength="32"
                bind:value={account.id}
              /><span class="field-help"
                >32文字以下の半角英数字とハイフン。先頭・末尾は英数字、ハイフンの連続は使えません。保存後は変更できません。</span
              ></label
            >
          {/if}
          <div class="form-grid">
            <label
              >銀行名<input
                type="text"
                required
                bind:value={account.bankName}
              /></label
            >
            <label
              >支店名<input
                type="text"
                required
                bind:value={account.branchName}
              /></label
            >
            <label
              >支店番号（任意）<input
                type="text"
                inputmode="numeric"
                maxlength="3"
                pattern={"[0-9]{3}"}
                bind:value={account.branchCode}
              /><span class="field-help">入力する場合は3桁の半角数字。</span
              ></label
            >
            <label
              >口座種別<select required bind:value={account.accountType}
                ><option value="" disabled>選択してください</option><option
                  value="ordinary">普通</option
                ><option value="checking">当座</option></select
              ></label
            >
            <label
              >口座番号<input
                type="text"
                required
                inputmode="numeric"
                minlength="7"
                maxlength="7"
                pattern={"[0-9]{7}"}
                bind:value={account.accountNumber}
              /><span class="field-help"
                >7桁の半角数字。先頭の0も入力してください。</span
              ></label
            >
            <label
              >口座名義<input
                type="text"
                required
                bind:value={account.accountHolderName}
              /></label
            >
          </div>
          <div class="actions">
            <label class="checkbox-label"
              ><input
                type="radio"
                name="default-bank-account"
                value={account.key}
                bind:group={form.defaultBankAccountKey}
              />既定の振込先</label
            >
            <button
              type="button"
              disabled={form.defaultBankAccountKey === account.key}
              aria-label={`振込先${index + 1}を削除`}
              onclick={() =>
                (form.bankAccounts = form.bankAccounts.filter(
                  (candidate) => candidate.key !== account.key,
                ))}>振込先を削除</button
            >
          </div>
          {#if form.defaultBankAccountKey === account.key}<p class="field-help">
              削除するには、先に別の振込先を既定にしてください。
            </p>{/if}
        </fieldset>
      {/each}
      <p class="muted">
        取引先から参照されている振込先は削除できません。既定の変更は、新しく登録する取引先の初期選択に使います。
      </p>
      <p class="muted">
        発行者情報の変更は、新しく作成する下書きから反映されます。
      </p>
      <div class="actions">
        <button type="submit" class="primary">発行者を保存</button>
        <button type="button" onclick={() => change(true)}
          >発行者の最新データを読み直す</button
        >
      </div>
      <p class="field-help">
        読み直すと、発行者・振込先の未保存の入力内容は破棄されます。
      </p>
    </fieldset>
  </form>
</section>

<style>
  .form-grid {
    align-items: start;
  }
  h3 {
    font-size: 1rem;
    margin: 0;
  }
  .section-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin: 2rem 0 1rem;
  }
  .bank-account {
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    padding: 1rem;
    margin: 1.5rem 0;
  }
  .bank-account legend {
    padding: 0 0.5rem;
    color: var(--text-muted);
    font-size: 0.875rem;
  }
  .bank-account .form-grid {
    margin: 1rem 0;
  }
  .operation-message {
    color: var(--accent);
  }
</style>
