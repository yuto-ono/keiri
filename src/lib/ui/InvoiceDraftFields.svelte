<script lang="ts">
  import type { InvoiceDetail } from "#lib/application/read-keiri-data";
  import type { Invoice } from "#lib/domain/model";
  import type { InvoiceCalculation } from "#lib/domain/invoice-calculation";
  import { formatBusinessMonth } from "#lib/domain/business-date";
  import {
    getBankAccountChoices,
    getEditingTaxCategory,
    type InvoiceDraftForm,
  } from "#lib/ui/invoice-editor";
  import { formatBankAccount, formatYen } from "#lib/ui/format";
  import InlineError from "./InlineError.svelte";
  let {
    form = $bindable(),
    invoice,
    options,
    calculation,
  }: {
    form: InvoiceDraftForm;
    invoice: Invoice;
    options: InvoiceDetail["editOptions"];
    calculation: InvoiceCalculation | null;
  } = $props();
  let tax = $derived(getEditingTaxCategory(invoice, options));
  let bankChoices = $derived(
    getBankAccountChoices(invoice, options.bankAccounts),
  );

  function moveLine(index: number, delta: number) {
    const lines = [...form.lineItems];
    [lines[index], lines[index + delta]] = [lines[index + delta], lines[index]];
    form.lineItems = lines;
  }
  function moveBank(index: number, delta: number) {
    const ids = [...form.bankAccountIds];
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    form.bankAccountIds = ids;
  }
</script>

<section class="panel content-panel" aria-labelledby="invoice-content-heading">
  <h2 id="invoice-content-heading">請求内容</h2>
  <dl class="details-grid">
    <div>
      <dt>取引先コード</dt>
      <dd>{invoice.businessPartner.code}</dd>
    </div>
    <div>
      <dt>宛名本体</dt>
      <dd>{invoice.businessPartner.snapshot.addressee}</dd>
    </div>
  </dl>
  <div class="form-grid">
    <label
      >敬称<select bind:value={form.honorific}
        ><option value="御中">御中</option><option value="様">様</option
        ></select
      ></label
    >
    <label
      >発行日<input type="date" required bind:value={form.issueDate} /><span
        class="field-help"
        >{formatBusinessMonth(
          invoice.issueDate.slice(0, 7),
        )}内で変更できます。</span
      ></label
    >
    <label
      >取引日<input
        type="date"
        required
        bind:value={form.transactionDate}
      /></label
    >
    <label
      >支払期限<input
        type="date"
        required
        bind:value={form.paymentDueDate}
      /></label
    >
  </div>
  <label class="checkbox-label"
    ><input
      type="checkbox"
      bind:checked={form.unitPricesIncludeTax}
    />明細の単価を税込として扱う</label
  >
  <div class="tax-definition">
    <strong>税区分</strong>
    {#if tax.ok}<p>
        {tax.value.name}（課税・標準税率 {tax.value.ratePercent}%）
      </p>{:else}<InlineError error={tax.error} />{/if}
  </div>
  <div class="section-heading">
    <h3>明細</h3>
    <button
      type="button"
      disabled={!tax.ok}
      onclick={() =>
        form.lineItems.push({
          name: "",
          quantity: undefined,
          unit: "",
          unitPrice: undefined,
        })}>明細を追加</button
    >
  </div>
  {#if !form.lineItems.length}<p class="muted">
      明細はありません。明細0件でも下書きとして保存できます。
    </p>{/if}
  {#each form.lineItems as item, index (index)}
    <fieldset class="line-item">
      <legend>明細 {index + 1}</legend>
      <div class="form-grid">
        <label class="item-name"
          >品目名<input type="text" required bind:value={item.name} /></label
        >
        <label
          >数量<input
            type="number"
            required
            min="0.01"
            max="999999999999.99"
            step="0.01"
            bind:value={item.quantity}
          /></label
        >
        <label>単位<input type="text" required bind:value={item.unit} /></label>
        <label
          >単価（円）<input
            type="number"
            required
            min="1"
            max="999999999999"
            step="1"
            bind:value={item.unitPrice}
          /></label
        >
      </div>
      <p>
        明細金額：{calculation
          ? formatYen(calculation.lineAmounts[index])
          : "—"}
      </p>
      <div class="actions">
        <button
          type="button"
          disabled={index === 0}
          aria-label={`明細${index + 1}を上へ`}
          onclick={() => moveLine(index, -1)}>上へ</button
        >
        <button
          type="button"
          disabled={index === form.lineItems.length - 1}
          aria-label={`明細${index + 1}を下へ`}
          onclick={() => moveLine(index, 1)}>下へ</button
        >
        <button
          type="button"
          aria-label={`明細${index + 1}を削除`}
          onclick={() => form.lineItems.splice(index, 1)}>明細を削除</button
        >
      </div>
    </fieldset>
  {/each}
  <label class="notes-field"
    >備考<textarea rows="4" bind:value={form.notes}></textarea></label
  >
  <label
    >PDF個別ファイル名<input
      type="text"
      bind:value={form.pdfFileNameOverride}
    /><span class="field-help"
      >拡張子を含まない名前を指定します。空欄の場合は取引先の命名規則を使います。</span
    ></label
  >
</section>

<section class="panel content-panel" aria-labelledby="bank-accounts-heading">
  <h2 id="bank-accounts-heading">振込先</h2>
  <div class="bank-choices">
    {#each bankChoices as account (account.id)}
      <label class="checkbox-label"
        ><input
          type="checkbox"
          value={account.id}
          bind:group={form.bankAccountIds}
          disabled={!options.bankAccounts.some(
            (current) => current.id === account.id,
          ) && !form.bankAccountIds.includes(account.id)}
        />{formatBankAccount(account)}</label
      >
    {/each}
  </div>
  <h3>表示順</h3>
  {#if !form.bankAccountIds.length}<p class="muted">
      振込先は選択されていません。発行には1件以上必要です。
    </p>{/if}
  <ol class="bank-order">
    {#each form.bankAccountIds as id, index (id)}
      <li>
        <span
          >{bankChoices.find((account) => account.id === id)?.bankName} / {bankChoices.find(
            (account) => account.id === id,
          )?.branchName}</span
        >
        <div class="actions">
          <button
            type="button"
            disabled={index === 0}
            aria-label={`振込先${index + 1}を上へ`}
            onclick={() => moveBank(index, -1)}>上へ</button
          ><button
            type="button"
            disabled={index === form.bankAccountIds.length - 1}
            aria-label={`振込先${index + 1}を下へ`}
            onclick={() => moveBank(index, 1)}>下へ</button
          >
        </div>
      </li>
    {/each}
  </ol>
</section>

<style>
  h3 {
    font-size: 1rem;
  }
  .form-grid {
    margin: 1rem 0;
  }
  .tax-definition {
    margin: 1.5rem 0;
  }
  .tax-definition p {
    margin: 0.5rem 0;
  }
  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin: 1.5rem 0 1rem;
  }
  .line-item {
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    padding: 1rem;
    margin: 1rem 0;
  }
  .line-item legend {
    padding: 0 0.5rem;
    color: var(--text-muted);
    font-size: 0.875rem;
  }
  .item-name {
    grid-column: 1 / -1;
  }
  .notes-field {
    margin: 1.5rem 0;
  }
  .bank-choices {
    display: grid;
    gap: 1rem;
    margin-bottom: 1.5rem;
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
</style>
