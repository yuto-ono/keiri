import type { DomainValidationIssue } from "#lib/domain/domain-validation-error";
import type { BusinessPartner, Issuer } from "#lib/domain/model";

const IDENTIFIER_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?!-))*[A-Za-z0-9]$|^[A-Za-z0-9]$/;

export function validateIssuerBankAccountReferences(
  issuer: Issuer,
): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];
  const seen = new Map<string, number>();
  issuer.bankAccounts.forEach((account, index) => {
    const normalized = account.id.toLowerCase();
    const firstIndex = seen.get(normalized);
    if (firstIndex !== undefined) {
      issues.push({
        path: ["bankAccounts", index, "id"],
        message: `振込先ID ${account.id} は bankAccounts[${firstIndex}] と大文字・小文字を区別せず重複しています。`,
      });
    } else {
      seen.set(normalized, index);
    }
  });
  if (
    !issuer.bankAccounts.some(
      (account) => account.id === issuer.defaultBankAccountId,
    )
  ) {
    issues.push({
      path: ["defaultBankAccountId"],
      message: `既定の振込先 ${issuer.defaultBankAccountId} がbankAccountsに存在しません。`,
    });
  }
  return issues;
}

export function validateIssuerUpdate(
  current: Issuer,
  proposed: Issuer,
  partners: readonly BusinessPartner[],
): DomainValidationIssue[] {
  const issues = validateIssuerBankAccountReferences(proposed);
  if (proposed.id !== current.id) {
    issues.push({ path: ["id"], message: "発行者IDは変更できません。" });
  }
  if (proposed.name.length === 0) {
    issues.push({
      path: ["name"],
      message: "発行者の氏名または名称は必須です。",
    });
  }
  if (!/^T\d{13}$/.test(proposed.registrationNumber)) {
    issues.push({
      path: ["registrationNumber"],
      message: "登録番号はTと13桁の半角数字にしてください。",
    });
  }
  for (const field of ["phone", "email"] as const) {
    if (proposed[field] !== null && proposed[field].length === 0) {
      issues.push({
        path: [field],
        message: "空でない文字列またはnullにしてください。",
      });
    }
    if (proposed[field] === null) {
      for (const partner of partners.filter(
        (partner) => partner.issuerDisplay[field],
      )) {
        issues.push({
          path: [field],
          message: `取引先 ${partner.code} が表示対象にしているため削除できません。先に取引先の表示設定を変更してください。`,
        });
      }
    }
  }
  if (proposed.bankAccounts.length === 0) {
    issues.push({
      path: ["bankAccounts"],
      message: "振込先は1件以上必要です。",
    });
  }
  proposed.bankAccounts.forEach((account, index) => {
    const existing = current.bankAccounts.find(
      (candidate) => candidate.id.toLowerCase() === account.id.toLowerCase(),
    );
    if (existing !== undefined && existing.id !== account.id) {
      issues.push({
        path: ["bankAccounts", index, "id"],
        message: "登録済みの振込先IDは大文字・小文字の表記も変更できません。",
      });
    }
    if (account.id.length > 32 || !IDENTIFIER_PATTERN.test(account.id)) {
      issues.push({
        path: ["bankAccounts", index, "id"],
        message:
          "振込先IDは32文字以下の半角英数字とハイフンで指定し、先頭・末尾とハイフンの連続を確認してください。",
      });
    }
    for (const field of [
      "bankName",
      "branchName",
      "accountHolderName",
    ] as const) {
      if (account[field].length === 0) {
        issues.push({
          path: ["bankAccounts", index, field],
          message: "空でない文字列が必要です。",
        });
      }
    }
    if (account.branchCode !== null && !/^\d{3}$/.test(account.branchCode)) {
      issues.push({
        path: ["bankAccounts", index, "branchCode"],
        message: "支店番号は3桁の半角数字またはnullにしてください。",
      });
    }
    if (!/^\d{7}$/.test(account.accountNumber)) {
      issues.push({
        path: ["bankAccounts", index, "accountNumber"],
        message: "口座番号は7桁の半角数字にしてください。",
      });
    }
  });
  const accountIds = new Set(
    proposed.bankAccounts.map((account) => account.id),
  );
  for (const partner of partners) {
    for (const id of partner.issuerDisplay.bankAccountIds) {
      if (!accountIds.has(id)) {
        issues.push({
          path: ["bankAccounts"],
          message: `振込先 ${id} は取引先 ${partner.code} から参照されています。先に取引先の選択から外してください。`,
        });
      }
    }
  }
  return issues;
}
