import type {
  AccountType,
  BankAccount,
  Issuer,
  Settings,
} from "#lib/domain/model";
import type { DomainValidationIssue } from "#lib/domain/domain-validation-error";
import { validateIssuerUpdate } from "#lib/domain/issuer";
import { validateRoundingSettings } from "#lib/domain/rounding";
import { readJsonApi, type ApiReadResult } from "#lib/ui/read-api";
import { writeJsonApi } from "#lib/ui/write-api";

export interface SettingsScreenData {
  issuer: Issuer;
  settings: Settings;
}
export interface IssuerBankAccountForm extends Omit<
  BankAccount,
  "branchCode" | "accountType"
> {
  key: number;
  savedId: string | null;
  branchCode: string;
  accountType: AccountType | "";
}
export interface IssuerForm {
  name: string;
  registrationNumber: string;
  phone: string;
  email: string;
  bankAccounts: IssuerBankAccountForm[];
  defaultBankAccountKey: number;
}

export async function loadSettingsScreen(
  fetcher: typeof fetch,
): Promise<ApiReadResult<SettingsScreenData>> {
  const [issuers, settings] = await Promise.all([
    readJsonApi<{ issuers: Issuer[] }>(fetcher, "/api/issuers"),
    readJsonApi<{ settings: Settings }>(fetcher, "/api/settings"),
  ]);
  if (!issuers.ok) return issuers;
  if (!settings.ok) return settings;
  if (issuers.value.issuers.length !== 1)
    return {
      ok: false,
      error: { message: "初期版の発行者は1件必要です。", issues: [] },
    };
  return {
    ok: true,
    value: {
      issuer: issuers.value.issuers[0],
      settings: settings.value.settings,
    },
  };
}

export function issuerApiPath(id: string): string {
  return `/api/issuers/${encodeURIComponent(id)}`;
}

export function createIssuerForm(issuer: Issuer): IssuerForm {
  return {
    name: issuer.name,
    registrationNumber: issuer.registrationNumber,
    phone: issuer.phone ?? "",
    email: issuer.email ?? "",
    bankAccounts: issuer.bankAccounts.map((account, key) => ({
      ...account,
      branchCode: account.branchCode ?? "",
      key,
      savedId: account.id,
    })),
    defaultBankAccountKey: issuer.bankAccounts.findIndex(
      (account) => account.id === issuer.defaultBankAccountId,
    ),
  };
}

export function appendIssuerBankAccount(form: IssuerForm): IssuerForm {
  const key =
    Math.max(-1, ...form.bankAccounts.map((account) => account.key)) + 1;
  return {
    ...form,
    bankAccounts: [
      ...form.bankAccounts,
      {
        key,
        savedId: null,
        id: "",
        bankName: "",
        branchName: "",
        branchCode: "",
        accountType: "",
        accountNumber: "",
        accountHolderName: "",
      },
    ],
  };
}

export function prepareIssuerForm(
  saved: Issuer,
  form: IssuerForm,
): ApiReadResult<Issuer> {
  const issues: DomainValidationIssue[] = [];
  const bankAccounts: BankAccount[] = form.bankAccounts.map(
    (account, index) => {
      if (account.accountType === "")
        issues.push({
          path: ["bankAccounts", index, "accountType"],
          message: "口座種別を選択してください。",
        });
      return {
        id: account.savedId ?? account.id,
        bankName: account.bankName,
        branchName: account.branchName,
        branchCode: account.branchCode === "" ? null : account.branchCode,
        accountType:
          account.accountType === "" ? "ordinary" : account.accountType,
        accountNumber: account.accountNumber,
        accountHolderName: account.accountHolderName,
      };
    },
  );
  const defaultAccount = form.bankAccounts.find(
    (account) => account.key === form.defaultBankAccountKey,
  );
  const proposed: Issuer = {
    id: saved.id,
    revision: saved.revision,
    name: form.name,
    registrationNumber: form.registrationNumber,
    phone: form.phone === "" ? null : form.phone,
    email: form.email === "" ? null : form.email,
    bankAccounts,
    defaultBankAccountId: defaultAccount?.savedId ?? defaultAccount?.id ?? "",
  };
  // 取引先からの参照は、書き込みAPIが最新データを使って再検証する。
  issues.push(...validateIssuerUpdate(saved, proposed, []));
  return issues.length
    ? { ok: false, error: { message: "入力内容を確認してください。", issues } }
    : { ok: true, value: proposed };
}

export async function saveIssuerForm(
  fetcher: typeof fetch,
  saved: Issuer,
  form: IssuerForm,
): Promise<ApiReadResult<{ issuer: Issuer }>> {
  const prepared = prepareIssuerForm(saved, form);
  if (!prepared.ok) return prepared;
  return writeJsonApi(fetcher, issuerApiPath(saved.id), "PUT", prepared.value);
}

export function createRoundingForm(settings: Settings): Settings["rounding"] {
  return { ...settings.rounding };
}

export function saveRoundingForm(
  fetcher: typeof fetch,
  saved: Settings,
  form: Settings["rounding"],
): Promise<ApiReadResult<{ settings: Settings }>> {
  const issues = validateRoundingSettings(form);
  if (issues.length)
    return Promise.resolve({
      ok: false,
      error: { message: "入力内容を確認してください。", issues },
    });
  return writeJsonApi(fetcher, "/api/settings", "PUT", {
    revision: saved.revision,
    rounding: { ...form },
  });
}
