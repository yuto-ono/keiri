import {
  DEFAULT_PDF_FILE_NAME_PATTERN,
  validateBusinessPartnerDetails,
} from "#lib/domain/business-partner";
import {
  DomainValidationError,
  type DomainValidationIssue,
} from "#lib/domain/domain-validation-error";
import type { BusinessPartner, Invoice, Issuer } from "#lib/domain/model";

export interface BusinessPartnerManagementContext {
  businessPartners: readonly BusinessPartner[];
  issuers: readonly Issuer[];
  invoices: readonly Invoice[];
}

export interface BusinessPartnerManagementGateway {
  loadManagementContext(): Promise<BusinessPartnerManagementContext>;
  saveNewBusinessPartner(
    partner: BusinessPartner,
  ): Promise<{ filePath: string }>;
  saveUpdatedBusinessPartner(
    current: BusinessPartner,
    updated: BusinessPartner,
  ): Promise<{ filePath: string }>;
  deleteBusinessPartner(
    partner: BusinessPartner,
  ): Promise<{ filePath: string }>;
}

export type CreateBusinessPartnerInput = Omit<
  BusinessPartner,
  "revision" | "issuerDisplay" | "pdfFileNamePattern" | "billingInstructions"
> & {
  issuerDisplay?: BusinessPartner["issuerDisplay"];
  pdfFileNamePattern?: string;
  billingInstructions?: string | null;
};

export interface BusinessPartnerSaveResult {
  businessPartner: BusinessPartner;
  filePath: string;
}

export async function createBusinessPartner(
  gateway: BusinessPartnerManagementGateway,
  input: CreateBusinessPartnerInput,
): Promise<BusinessPartnerSaveResult> {
  const context = await gateway.loadManagementContext();
  const issuer = requireIssuer(context);
  const partner: BusinessPartner = {
    ...input,
    revision: 1,
    billingInstructions: input.billingInstructions ?? null,
    pdfFileNamePattern:
      input.pdfFileNamePattern ?? DEFAULT_PDF_FILE_NAME_PATTERN,
    issuerDisplay:
      input.issuerDisplay === undefined
        ? {
            phone: issuer.phone !== null,
            email: issuer.email !== null,
            bankAccountIds: [issuer.defaultBankAccountId],
          }
        : {
            ...input.issuerDisplay,
            bankAccountIds: [...input.issuerDisplay.bankAccountIds],
          },
  };
  const issues = validateBusinessPartnerDetails(partner, issuer);
  validateUniqueCode(partner.code, context.businessPartners, issues);
  rejectIssues(issues);
  const saved = await gateway.saveNewBusinessPartner(partner);
  return { businessPartner: partner, filePath: saved.filePath };
}

export async function updateBusinessPartner(
  gateway: BusinessPartnerManagementGateway,
  code: string,
  proposed: BusinessPartner,
): Promise<BusinessPartnerSaveResult> {
  const context = await gateway.loadManagementContext();
  const current = requirePartner(context, code);
  const issues = validateBusinessPartnerDetails(
    proposed,
    requireIssuer(context),
  );
  validateRevision(proposed.revision, current.revision, issues);
  validateUniqueCode(
    proposed.code,
    context.businessPartners.filter((partner) => partner.code !== current.code),
    issues,
  );
  if (proposed.code !== current.code && isReferenced(context, current.code)) {
    issues.push({
      path: ["code"],
      message: "請求書から参照されている取引先のコードは変更できません。",
    });
  }
  rejectIssues(issues);
  const updated: BusinessPartner = {
    ...proposed,
    revision: current.revision + 1,
    issuerDisplay: {
      ...proposed.issuerDisplay,
      bankAccountIds: [...proposed.issuerDisplay.bankAccountIds],
    },
  };
  const saved = await gateway.saveUpdatedBusinessPartner(current, updated);
  return { businessPartner: updated, filePath: saved.filePath };
}

export async function deleteBusinessPartner(
  gateway: BusinessPartnerManagementGateway,
  input: { code: string; expectedRevision: number },
): Promise<{ code: string; filePath: string }> {
  const context = await gateway.loadManagementContext();
  const current = requirePartner(context, input.code);
  const issues: DomainValidationIssue[] = [];
  validateRevision(input.expectedRevision, current.revision, issues);
  if (isReferenced(context, current.code)) {
    issues.push({
      path: ["code"],
      message: "請求書から参照されている取引先は削除できません。",
    });
  }
  rejectIssues(issues);
  const deleted = await gateway.deleteBusinessPartner(current);
  return { code: current.code, filePath: deleted.filePath };
}

function requireIssuer(context: BusinessPartnerManagementContext): Issuer {
  if (context.issuers.length !== 1) {
    throw new DomainValidationError("取引先を保存できません。", [
      { path: ["issuers"], message: "初期版の発行者は1件必要です。" },
    ]);
  }
  return context.issuers[0];
}

function requirePartner(
  context: BusinessPartnerManagementContext,
  code: string,
): BusinessPartner {
  const partner = context.businessPartners.find(
    (candidate) => candidate.code === code,
  );
  if (partner === undefined) {
    throw new DomainValidationError("取引先を変更できません。", [
      { path: ["code"], message: `取引先 ${code} が存在しません。` },
    ]);
  }
  return partner;
}

function isReferenced(
  context: BusinessPartnerManagementContext,
  code: string,
): boolean {
  return context.invoices.some(
    (invoice) => invoice.businessPartner.code === code,
  );
}

function validateUniqueCode(
  code: string,
  partners: readonly BusinessPartner[],
  issues: DomainValidationIssue[],
): void {
  if (
    partners.some(
      (partner) => partner.code.toLowerCase() === code.toLowerCase(),
    )
  ) {
    issues.push({
      path: ["code"],
      message: `取引先コード ${code} は大文字・小文字を区別せず既に使用されています。`,
    });
  }
}

function validateRevision(
  expected: number,
  current: number,
  issues: DomainValidationIssue[],
): void {
  if (!Number.isSafeInteger(expected) || expected < 1) {
    issues.push({
      path: ["revision"],
      message: "期待リビジョンは1以上の安全な整数にしてください。",
    });
  } else if (expected !== current) {
    issues.push({
      path: ["revision"],
      message: `期待リビジョン${expected}は現在のリビジョン${current}と一致しません。`,
    });
  }
}

function rejectIssues(issues: readonly DomainValidationIssue[]): void {
  if (issues.length > 0) {
    throw new DomainValidationError("取引先を変更できません。", issues);
  }
}
