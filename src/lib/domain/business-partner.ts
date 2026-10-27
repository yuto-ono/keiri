import type { DomainValidationIssue } from "#lib/domain/domain-validation-error";
import type { BusinessPartner, Issuer } from "#lib/domain/model";
import { validatePdfFileNamePattern } from "#lib/domain/pdf-file-name";

export const DEFAULT_PDF_FILE_NAME_PATTERN =
  "{businessPartnerCode}-{invoiceDate:YYYYMM}-{sequence}";

export function validateBusinessPartnerDetails(
  partner: BusinessPartner,
  issuer: Issuer,
): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];
  if (!/^[A-Za-z0-9]{1,12}$/.test(partner.code)) {
    issues.push({
      path: ["code"],
      message: "取引先コードは1〜12文字の半角英数字にしてください。",
    });
  }
  if (partner.addressee.length === 0) {
    issues.push({ path: ["addressee"], message: "宛名は必須です。" });
  }
  if (
    partner.billingInstructions !== null &&
    partner.billingInstructions.length === 0
  ) {
    issues.push({
      path: ["billingInstructions"],
      message: "請求指示は空でない文字列またはnullにしてください。",
    });
  }
  if (partner.issuerDisplay.bankAccountIds.length === 0) {
    issues.push({
      path: ["issuerDisplay", "bankAccountIds"],
      message: "振込先を1件以上選択してください。",
    });
  }
  issues.push(...validatePdfFileNamePattern(partner.pdfFileNamePattern));
  issues.push(...validateBusinessPartnerIssuerDisplay(partner, issuer));
  return issues;
}

export function validateBusinessPartnerIssuerDisplay(
  partner: BusinessPartner,
  issuer: Issuer,
): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];
  if (partner.issuerDisplay.phone && issuer.phone === null) {
    issues.push({
      path: ["issuerDisplay", "phone"],
      message: "発行者に電話番号がないため表示できません。",
    });
  }
  if (partner.issuerDisplay.email && issuer.email === null) {
    issues.push({
      path: ["issuerDisplay", "email"],
      message: "発行者にメールアドレスがないため表示できません。",
    });
  }
  const seen = new Set<string>();
  partner.issuerDisplay.bankAccountIds.forEach((id, index) => {
    const path = ["issuerDisplay", "bankAccountIds", index];
    if (seen.has(id)) {
      issues.push({ path, message: `振込先ID ${id} が重複しています。` });
    }
    seen.add(id);
    if (!issuer.bankAccounts.some((account) => account.id === id)) {
      issues.push({ path, message: `発行者に振込先 ${id} が存在しません。` });
    }
  });
  return issues;
}
