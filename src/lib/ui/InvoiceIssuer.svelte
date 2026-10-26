<script lang="ts">
  import type { Invoice } from "#lib/domain/model";
  import { formatBankAccount } from "#lib/ui/format";
  let {
    snapshot,
    showBanks,
  }: { snapshot: Invoice["issuer"]["snapshot"]; showBanks: boolean } = $props();
</script>

<section class="panel content-panel" aria-labelledby="issuer-heading">
  <h2 id="issuer-heading">発行者</h2>
  <dl class="details-grid">
    <div>
      <dt>氏名・名称</dt>
      <dd>{snapshot.name}</dd>
    </div>
    <div>
      <dt>登録番号</dt>
      <dd>{snapshot.registrationNumber}</dd>
    </div>
    {#if snapshot.phone.visible}<div>
        <dt>電話番号</dt>
        <dd>{snapshot.phone.value}</dd>
      </div>{/if}
    {#if snapshot.email.visible}<div>
        <dt>メールアドレス</dt>
        <dd>{snapshot.email.value}</dd>
      </div>{/if}
  </dl>
  {#if showBanks}
    <h3>振込先</h3>
    {#each snapshot.bankAccounts as account (account.id)}<p>
        {formatBankAccount(account)}
      </p>{/each}
  {/if}
</section>

<style>
  h3 {
    margin-top: 1.5rem;
    font-size: 1rem;
  }
  p {
    overflow-wrap: anywhere;
  }
</style>
