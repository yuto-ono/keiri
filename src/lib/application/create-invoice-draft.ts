import { isBusinessDate } from "#lib/domain/business-date";
import {
  DomainValidationError,
  type DomainValidationIssue,
} from "#lib/domain/domain-validation-error";
import type {
  BusinessPartner,
  Invoice,
  Issuer,
  Settings,
  TaxCategory,
} from "#lib/domain/model";
import { selectCurrentStandardTaxCategory } from "#lib/domain/tax-category";

export interface InvoiceCreationContext {
  businessPartners: readonly BusinessPartner[];
  issuers: readonly Issuer[];
  taxCategories: readonly TaxCategory[];
  settings: Settings;
  invoices: readonly Invoice[];
}

export interface InvoiceCreationGateway {
  loadCreationContext(): Promise<InvoiceCreationContext>;
  saveNewInvoice(invoice: Invoice): Promise<{ filePath: string }>;
}

export interface CreateInvoiceDraftInput {
  businessPartnerCode: string;
  paymentDueDate: string;
  issueDate?: string;
  today: string;
}

export interface CreateInvoiceDraftResult {
  invoice: Invoice;
  filePath: string;
}

export interface InvoiceDraftInitialContent {
  lineItems: Invoice["lineItems"];
  notes: string | null;
}

export async function createInvoiceDraft(
  gateway: InvoiceCreationGateway,
  input: CreateInvoiceDraftInput,
): Promise<CreateInvoiceDraftResult> {
  const context = await gateway.loadCreationContext();
  const invoice = buildInvoiceDraft(context, input);
  const saved = await gateway.saveNewInvoice(invoice);
  return { invoice, filePath: saved.filePath };
}

export function buildInvoiceDraft(
  context: InvoiceCreationContext,
  input: CreateInvoiceDraftInput,
  initialContent: InvoiceDraftInitialContent = { lineItems: [], notes: null },
): Invoice {
  const issueDate = input.issueDate ?? input.today;
  const dateIssues = validateInputDates(
    input.today,
    issueDate,
    input.paymentDueDate,
  );
  if (dateIssues.length > 0) {
    throw new DomainValidationError("請求書の作成条件が不正です。", dateIssues);
  }

  const businessPartner = context.businessPartners.find(
    (candidate) => candidate.code === input.businessPartnerCode,
  );
  if (businessPartner === undefined) {
    throw new DomainValidationError("請求書を作成できません。", [
      {
        path: ["businessPartnerCode"],
        message: `取引先 ${input.businessPartnerCode} が存在しません。`,
      },
    ]);
  }

  if (context.issuers.length !== 1) {
    throw new DomainValidationError("請求書を作成できません。", [
      {
        path: ["issuers"],
        message: `初期版の発行者は1件必要ですが、${context.issuers.length}件あります。`,
      },
    ]);
  }

  selectCurrentStandardTaxCategory(context.taxCategories);

  const issuer = context.issuers[0];
  const snapshotIssues = validateSnapshotSource(businessPartner, issuer);
  if (snapshotIssues.length > 0) {
    throw new DomainValidationError(
      "取引先と発行者の情報から請求書を作成できません。",
      snapshotIssues,
    );
  }

  const invoiceNumber = allocateInvoiceNumber(
    businessPartner.code,
    issueDate,
    context.invoices,
  );
  return {
    revision: 1,
    status: "draft",
    invoiceNumber,
    businessPartner: {
      code: businessPartner.code,
      snapshot: {
        addressee: businessPartner.addressee,
        honorific: businessPartner.honorific,
      },
    },
    issuer: {
      id: issuer.id,
      snapshot: {
        name: issuer.name,
        registrationNumber: issuer.registrationNumber,
        phone: businessPartner.issuerDisplay.phone
          ? { visible: true, value: issuer.phone as string }
          : { visible: false },
        email: businessPartner.issuerDisplay.email
          ? { visible: true, value: issuer.email as string }
          : { visible: false },
        bankAccounts: businessPartner.issuerDisplay.bankAccountIds.map(
          (bankAccountId) => ({
            ...(issuer.bankAccounts.find(
              (bankAccount) => bankAccount.id === bankAccountId,
            ) as Issuer["bankAccounts"][number]),
          }),
        ),
      },
    },
    issueDate,
    transactionDate: issueDate,
    paymentDueDate: input.paymentDueDate,
    paymentCompletedDate: null,
    unitPricesIncludeTax: businessPartner.unitPricesIncludeTax,
    lineItems: initialContent.lineItems.map((lineItem) => ({ ...lineItem })),
    notes: initialContent.notes,
    rounding: { ...context.settings.rounding },
    pdf: { fileNameOverride: null, issuedFileName: null },
  };
}

function validateInputDates(
  today: string,
  issueDate: string,
  paymentDueDate: string,
): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];
  if (!isBusinessDate(today)) {
    issues.push({ path: ["today"], message: "現在日が不正です。" });
  }
  if (!isBusinessDate(issueDate)) {
    issues.push({ path: ["issueDate"], message: "発行日が不正です。" });
  }
  if (!isBusinessDate(paymentDueDate)) {
    issues.push({
      path: ["paymentDueDate"],
      message: "支払期限が不正です。",
    });
  }
  return issues;
}

function validateSnapshotSource(
  businessPartner: BusinessPartner,
  issuer: Issuer,
): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];
  if (businessPartner.issuerDisplay.phone && issuer.phone === null) {
    issues.push({
      path: ["issuerDisplay", "phone"],
      message: "表示対象の電話番号が発行者に登録されていません。",
    });
  }
  if (businessPartner.issuerDisplay.email && issuer.email === null) {
    issues.push({
      path: ["issuerDisplay", "email"],
      message: "表示対象のメールアドレスが発行者に登録されていません。",
    });
  }
  businessPartner.issuerDisplay.bankAccountIds.forEach(
    (bankAccountId, index) => {
      if (
        !issuer.bankAccounts.some(
          (bankAccount) => bankAccount.id === bankAccountId,
        )
      ) {
        issues.push({
          path: ["issuerDisplay", "bankAccountIds", index],
          message: `振込先 ${bankAccountId} が発行者に登録されていません。`,
        });
      }
    },
  );
  return issues;
}

function allocateInvoiceNumber(
  businessPartnerCode: string,
  issueDate: string,
  invoices: readonly Invoice[],
): string {
  const issueMonth = issueDate.slice(0, 7).replace("-", "");
  const prefix = `${businessPartnerCode}-${issueMonth}-`;
  const sequences = invoices
    .filter((invoice) => invoice.invoiceNumber.startsWith(prefix))
    .map((invoice) => Number(invoice.invoiceNumber.slice(prefix.length)))
    .filter(
      (sequence) =>
        Number.isInteger(sequence) && sequence >= 1 && sequence <= 99,
    );
  const sequence = (sequences.length === 0 ? 0 : Math.max(...sequences)) + 1;

  if (sequence > 99) {
    throw new DomainValidationError("請求書を作成できません。", [
      {
        path: ["invoiceNumber"],
        message: `${businessPartnerCode}の${issueMonth}に採番可能な請求書番号がありません。`,
      },
    ]);
  }

  const invoiceNumber = `${prefix}${String(sequence).padStart(2, "0")}`;
  if (invoices.some((invoice) => invoice.invoiceNumber === invoiceNumber)) {
    throw new DomainValidationError("請求書を作成できません。", [
      {
        path: ["invoiceNumber"],
        message: `請求書番号 ${invoiceNumber} は既に使用されています。`,
      },
    ]);
  }
  return invoiceNumber;
}
