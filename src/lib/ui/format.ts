import type { ApiIssue } from "#lib/ui/read-api";

const yenFormatter = new Intl.NumberFormat("ja-JP");

export function formatYen(amount: string): string {
  return `${yenFormatter.format(BigInt(amount))}円`;
}

export function formatIssueLocation(
  issue: ApiIssue,
  filePath?: string,
): string {
  const file = issue.filePath ?? filePath;
  const position =
    issue.line === undefined
      ? ""
      : `${issue.line}行${issue.column === undefined ? "" : ` ${issue.column}列`}`;
  return [file, issue.path.join("."), position].filter(Boolean).join(" / ");
}
