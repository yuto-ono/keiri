import { isBusinessDate, isSameBusinessMonth } from "#lib/domain/business-date";
import {
  DomainValidationError,
  type DomainValidationIssue,
} from "#lib/domain/domain-validation-error";
import { validateInvoiceDraftContent } from "#lib/domain/invoice-draft-content";
import type {
  BankAccount,
  Invoice,
  Issuer,
  IssuerContactSnapshot,
  TaxCategory,
} from "#lib/domain/model";

export interface InvoiceUpdateContext {
  invoice: Invoice | undefined;
  issuer: Issuer | undefined;
  taxCategories: readonly TaxCategory[];
}

export interface InvoiceUpdateGateway {
  loadUpdateContext(invoiceNumber: string): Promise<InvoiceUpdateContext>;
  saveUpdatedInvoice(
    currentInvoice: Invoice,
    updatedInvoice: Invoice,
  ): Promise<{ filePath: string }>;
}

export interface UpdateInvoiceDraftResult {
  invoice: Invoice;
  filePath: string;
}

export async function updateInvoiceDraft(
  gateway: InvoiceUpdateGateway,
  invoiceNumber: string,
  proposedInvoice: Invoice,
): Promise<UpdateInvoiceDraftResult> {
  const context = await gateway.loadUpdateContext(invoiceNumber);
  const currentInvoice = context.invoice;
  if (currentInvoice === undefined) {
    throw new DomainValidationError("請求書を更新できません。", [
      {
        path: ["invoiceNumber"],
        message: `請求書 ${invoiceNumber} が存在しません。`,
      },
    ]);
  }

  const issues = validateUpdate(
    invoiceNumber,
    currentInvoice,
    proposedInvoice,
    context,
  );
  if (issues.length > 0) {
    throw new DomainValidationError("請求書を更新できません。", issues);
  }

  const updatedInvoice: Invoice = {
    ...proposedInvoice,
    revision: currentInvoice.revision + 1,
  };
  const saved = await gateway.saveUpdatedInvoice(
    currentInvoice,
    updatedInvoice,
  );
  return { invoice: updatedInvoice, filePath: saved.filePath };
}

function validateUpdate(
  requestedInvoiceNumber: string,
  current: Invoice,
  proposed: Invoice,
  context: InvoiceUpdateContext,
): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];

  if (current.status !== "draft") {
    issues.push({
      path: ["status"],
      message: "発行済み請求書の請求内容は更新できません。",
    });
  }
  if (proposed.invoiceNumber !== requestedInvoiceNumber) {
    issues.push({
      path: ["invoiceNumber"],
      message: "位置引数と入力内の請求書番号が一致しません。",
    });
  }
  if (proposed.invoiceNumber !== current.invoiceNumber) {
    immutableIssue(issues, ["invoiceNumber"], "請求書番号");
  }
  if (proposed.revision !== current.revision) {
    issues.push({
      path: ["revision"],
      message: `期待リビジョン${proposed.revision}は現在のリビジョン${current.revision}と一致しません。`,
    });
  }
  if (proposed.status !== current.status) {
    immutableIssue(issues, ["status"], "状態");
  }
  if (proposed.paymentCompletedDate !== current.paymentCompletedDate) {
    immutableIssue(issues, ["paymentCompletedDate"], "入金完了日");
  }
  if (proposed.pdf.issuedFileName !== current.pdf.issuedFileName) {
    immutableIssue(issues, ["pdf", "issuedFileName"], "発行済みPDFファイル名");
  }
  if (!sameBusinessPartner(proposed, current)) {
    immutableIssue(
      issues,
      ["businessPartner"],
      "取引先情報のスナップショット",
    );
  }
  if (!sameIssuerIdentityAndContact(proposed, current)) {
    immutableIssue(issues, ["issuer"], "発行者と連絡先のスナップショット");
  }
  if (
    proposed.rounding.lineAmount !== current.rounding.lineAmount ||
    proposed.rounding.taxAmount !== current.rounding.taxAmount
  ) {
    immutableIssue(issues, ["rounding"], "端数処理設定");
  }

  if (
    isBusinessDate(proposed.issueDate) &&
    !isSameBusinessMonth(proposed.issueDate, current.issueDate)
  ) {
    issues.push({
      path: ["issueDate"],
      message: "発行年月は保存後に変更できません。",
    });
  }
  validateBankAccounts(current, proposed, context.issuer, issues);
  issues.push(...validateInvoiceDraftContent(proposed, context.taxCategories));
  return issues;
}

function validateBankAccounts(
  current: Invoice,
  proposed: Invoice,
  issuer: Issuer | undefined,
  issues: DomainValidationIssue[],
): void {
  const currentAccounts = current.issuer.snapshot.bankAccounts;
  const proposedAccounts = proposed.issuer.snapshot.bankAccounts;
  if (sameBankAccountList(currentAccounts, proposedAccounts)) {
    return;
  }
  if (issuer === undefined || issuer.id !== current.issuer.id) {
    issues.push({
      path: ["issuer", "snapshot", "bankAccounts"],
      message: "現在の発行者情報を確認できないため振込先を変更できません。",
    });
    return;
  }

  const seenIds = new Set<string>();
  proposedAccounts.forEach((account, index) => {
    if (seenIds.has(account.id)) {
      issues.push({
        path: ["issuer", "snapshot", "bankAccounts", index, "id"],
        message: `振込先 ${account.id} が重複しています。`,
      });
    }
    seenIds.add(account.id);

    const registered = issuer.bankAccounts.find(
      (candidate) => candidate.id === account.id,
    );
    if (registered === undefined) {
      issues.push({
        path: ["issuer", "snapshot", "bankAccounts", index, "id"],
        message: `振込先 ${account.id} は現在の発行者に登録されていません。`,
      });
      return;
    }

    const existingSnapshot = currentAccounts.find(
      (candidate) => candidate.id === account.id,
    );
    const expected = existingSnapshot ?? registered;
    if (!sameBankAccount(account, expected)) {
      issues.push({
        path: ["issuer", "snapshot", "bankAccounts", index],
        message: `振込先 ${account.id} の登録情報は請求書単位で変更できません。`,
      });
    }
  });
}

function sameBusinessPartner(left: Invoice, right: Invoice): boolean {
  return (
    left.businessPartner.code === right.businessPartner.code &&
    left.businessPartner.snapshot.addressee ===
      right.businessPartner.snapshot.addressee
  );
}

function sameIssuerIdentityAndContact(left: Invoice, right: Invoice): boolean {
  return (
    left.issuer.id === right.issuer.id &&
    left.issuer.snapshot.name === right.issuer.snapshot.name &&
    left.issuer.snapshot.registrationNumber ===
      right.issuer.snapshot.registrationNumber &&
    sameContact(left.issuer.snapshot.phone, right.issuer.snapshot.phone) &&
    sameContact(left.issuer.snapshot.email, right.issuer.snapshot.email)
  );
}

function sameContact(
  left: IssuerContactSnapshot,
  right: IssuerContactSnapshot,
): boolean {
  return (
    left.visible === right.visible &&
    (!left.visible || (right.visible && left.value === right.value))
  );
}

function sameBankAccountList(
  left: readonly BankAccount[],
  right: readonly BankAccount[],
): boolean {
  return (
    left.length === right.length &&
    left.every((account, index) => sameBankAccount(account, right[index]))
  );
}

function sameBankAccount(left: BankAccount, right: BankAccount): boolean {
  return (
    left.id === right.id &&
    left.bankName === right.bankName &&
    left.branchName === right.branchName &&
    left.branchCode === right.branchCode &&
    left.accountType === right.accountType &&
    left.accountNumber === right.accountNumber &&
    left.accountHolderName === right.accountHolderName
  );
}

function immutableIssue(
  issues: DomainValidationIssue[],
  path: readonly (string | number)[],
  label: string,
): void {
  issues.push({ path, message: `${label}は通常更新では変更できません。` });
}
