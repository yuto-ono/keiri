import type { ApiIssue } from "#lib/ui/read-api";
import type { BankAccount, RoundingMethod } from "#lib/domain/model";

const yenFormatter = new Intl.NumberFormat("ja-JP");

export function formatBankAccount(account: BankAccount): string {
  return `${account.bankName} ${account.branchName}${account.branchCode === null ? "" : `（${account.branchCode}）`} ${account.accountType === "ordinary" ? "普通" : "当座"} ${account.accountNumber} ${account.accountHolderName}`;
}

export function formatRoundingMethod(method: RoundingMethod): string {
  return { floor: "切り捨て", halfUp: "四捨五入", ceil: "切り上げ" }[method];
}

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
