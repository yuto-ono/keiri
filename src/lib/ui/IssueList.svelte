<script lang="ts">
  import type { ApiIssue } from "#lib/ui/read-api";
  import { formatIssueLocation } from "#lib/ui/format";

  let { issues, filePath }: { issues: readonly ApiIssue[]; filePath?: string } =
    $props();
</script>

<ul class="issue-list">
  {#each issues as issue, index (index)}
    {@const location = formatIssueLocation(issue, filePath)}
    <li>
      {#if location}
        <code>{location}</code>
      {/if}
      <span>{issue.message}</span>
    </li>
  {/each}
</ul>

<style>
  .issue-list {
    margin: 1rem 0;
    padding-left: 1.5rem;
  }
  li + li {
    margin-top: 0.75rem;
  }
  code {
    display: block;
    overflow-wrap: anywhere;
  }
  span {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
