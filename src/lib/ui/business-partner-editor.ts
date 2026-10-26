import type { CreateBusinessPartnerInput } from "#lib/application/manage-business-partners";
import type {
  getBusinessPartner,
  listBusinessPartners,
} from "#lib/application/read-keiri-data";
import {
  DEFAULT_PDF_FILE_NAME_PATTERN,
  validateBusinessPartnerDetails,
} from "#lib/domain/business-partner";
import type { BusinessPartner, Issuer } from "#lib/domain/model";
import type { DomainValidationIssue } from "#lib/domain/domain-validation-error";
import { readJsonApi, type ApiReadResult } from "#lib/ui/read-api";
import { writeJsonApi } from "#lib/ui/write-api";

export type BusinessPartnerListData = Awaited<
  ReturnType<typeof listBusinessPartners>
>;
type BusinessPartnerDetailData = NonNullable<
  Awaited<ReturnType<typeof getBusinessPartner>>
>;
export interface BusinessPartnerEditorData {
  businessPartner: BusinessPartner | null;
  hasInvoiceReferences: boolean;
  issuer: Issuer;
}
export interface BusinessPartnerForm {
  code: string;
  addressee: string;
  honorific: BusinessPartner["honorific"] | "";
  requiresMonthlyInvoice: "yes" | "no" | "";
  billingInstructions: string;
  unitPricesIncludeTax: "yes" | "no" | "";
  showPhone: boolean;
  showEmail: boolean;
  bankAccountIds: string[];
  pdfFileNamePattern: string;
}

export function businessPartnerApiPath(code: string): string {
  return `/api/business-partners/${encodeURIComponent(code)}`;
}

export async function loadBusinessPartnerEditor(
  fetcher: typeof fetch,
  code?: string,
): Promise<ApiReadResult<BusinessPartnerEditorData>> {
  const [issuers, detail] = await Promise.all([
    readJsonApi<{ issuers: Issuer[] }>(fetcher, "/api/issuers"),
    code === undefined
      ? undefined
      : readJsonApi<BusinessPartnerDetailData>(
          fetcher,
          businessPartnerApiPath(code),
        ),
  ]);
  if (!issuers.ok) return issuers;
  if (detail && !detail.ok) return detail;
  if (issuers.value.issuers.length !== 1)
    return {
      ok: false,
      error: { message: "初期版の発行者は1件必要です。", issues: [] },
    };
  return {
    ok: true,
    value: {
      businessPartner: detail?.value.businessPartner ?? null,
      hasInvoiceReferences: detail?.value.hasInvoiceReferences ?? false,
      issuer: issuers.value.issuers[0],
    },
  };
}

export function createBusinessPartnerForm(
  partner: BusinessPartner | null,
  issuer: Issuer,
): BusinessPartnerForm {
  return {
    code: partner?.code ?? "",
    addressee: partner?.addressee ?? "",
    honorific: partner?.honorific ?? "",
    requiresMonthlyInvoice:
      partner === null ? "" : partner.requiresMonthlyInvoice ? "yes" : "no",
    billingInstructions: partner?.billingInstructions ?? "",
    unitPricesIncludeTax:
      partner === null ? "" : partner.unitPricesIncludeTax ? "yes" : "no",
    showPhone: partner?.issuerDisplay.phone ?? issuer.phone !== null,
    showEmail: partner?.issuerDisplay.email ?? issuer.email !== null,
    bankAccountIds:
      partner === null
        ? [issuer.defaultBankAccountId]
        : [...partner.issuerDisplay.bankAccountIds],
    pdfFileNamePattern:
      partner?.pdfFileNamePattern ?? DEFAULT_PDF_FILE_NAME_PATTERN,
  };
}

export function prepareBusinessPartnerForm(
  form: BusinessPartnerForm,
  issuer: Issuer,
): ApiReadResult<CreateBusinessPartnerInput> {
  const issues: DomainValidationIssue[] = [];
  if (form.honorific === "")
    issues.push({ path: ["honorific"], message: "敬称を選択してください。" });
  if (form.requiresMonthlyInvoice === "")
    issues.push({
      path: ["requiresMonthlyInvoice"],
      message: "月次請求の対象かを選択してください。",
    });
  if (form.unitPricesIncludeTax === "")
    issues.push({
      path: ["unitPricesIncludeTax"],
      message: "単価の税込・税抜を選択してください。",
    });
  if (issues.length || form.honorific === "")
    return {
      ok: false,
      error: { message: "入力内容を確認してください。", issues },
    };
  const partner = {
    code: form.code,
    addressee: form.addressee,
    honorific: form.honorific,
    requiresMonthlyInvoice: form.requiresMonthlyInvoice === "yes",
    billingInstructions:
      form.billingInstructions === "" ? null : form.billingInstructions,
    unitPricesIncludeTax: form.unitPricesIncludeTax === "yes",
    issuerDisplay: {
      phone: form.showPhone,
      email: form.showEmail,
      bankAccountIds: [...form.bankAccountIds],
    },
    pdfFileNamePattern: form.pdfFileNamePattern,
  };
  issues.push(
    ...validateBusinessPartnerDetails({ ...partner, revision: 1 }, issuer),
  );
  return issues.length
    ? { ok: false, error: { message: "入力内容を確認してください。", issues } }
    : { ok: true, value: partner };
}

export async function saveBusinessPartnerForm(
  fetcher: typeof fetch,
  saved: BusinessPartner | null,
  form: BusinessPartnerForm,
  issuer: Issuer,
): Promise<ApiReadResult<{ businessPartner: BusinessPartner }>> {
  const prepared = prepareBusinessPartnerForm(form, issuer);
  if (!prepared.ok) return prepared;
  return saved === null
    ? writeJsonApi(fetcher, "/api/business-partners", "POST", prepared.value)
    : writeJsonApi(fetcher, businessPartnerApiPath(saved.code), "PUT", {
        ...prepared.value,
        revision: saved.revision,
      });
}

export function deleteSavedBusinessPartner(
  fetcher: typeof fetch,
  saved: BusinessPartner,
): Promise<ApiReadResult<{ code: string }>> {
  return writeJsonApi(fetcher, businessPartnerApiPath(saved.code), "DELETE", {
    revision: saved.revision,
  });
}

export function moveBusinessPartnerBank(
  ids: readonly string[],
  index: number,
  delta: -1 | 1,
): string[] {
  const result = [...ids];
  const target = index + delta;
  if (index >= 0 && index < ids.length && target >= 0 && target < ids.length)
    [result[index], result[target]] = [result[target], result[index]];
  return result;
}

export function selectBusinessPartnerBank(
  ids: readonly string[],
  id: string,
  selected: boolean,
): string[] {
  return selected
    ? ids.includes(id)
      ? [...ids]
      : [...ids, id]
    : ids.filter((candidate) => candidate !== id);
}
