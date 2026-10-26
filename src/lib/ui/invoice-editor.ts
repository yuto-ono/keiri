import type { InvoiceDetail } from "#lib/application/read-keiri-data";
import {
  DomainValidationError,
  type DomainValidationIssue,
} from "#lib/domain/domain-validation-error";
import { validateInvoiceDraftContent } from "#lib/domain/invoice-draft-content";
import {
  resolveInvoiceAmounts,
  type InvoiceCalculation,
} from "#lib/domain/invoice-calculation";
import { validateInvoiceForIssue } from "#lib/domain/invoice-validation";
import {
  validateInvoiceForPaymentManagement,
  validatePaymentCompletedDate,
} from "#lib/domain/invoice-payment";
import type {
  BankAccount,
  Invoice,
  InvoiceLineItem,
  TaxableTaxCategory,
} from "#lib/domain/model";
import { selectCurrentStandardTaxCategory } from "#lib/domain/tax-category";
import type { ApiReadResult } from "#lib/ui/read-api";
import { writeJsonApi } from "#lib/ui/write-api";

export interface InvoiceDetailData extends InvoiceDetail {
  today: string;
}

export interface InvoiceDraftForm {
  issueDate: string;
  transactionDate: string;
  paymentDueDate: string;
  honorific: Invoice["businessPartner"]["snapshot"]["honorific"] | "";
  unitPricesIncludeTax: boolean;
  lineItems: (Omit<
    InvoiceLineItem,
    "taxCategoryId" | "quantity" | "unitPrice"
  > & { quantity: number | undefined; unitPrice: number | undefined })[];
  bankAccountIds: string[];
  notes: string;
  pdfFileNameOverride: string;
}

export interface InvoiceDraftFieldContext {
  businessPartnerCode: string;
  addressee: string;
  issueMonth: string | null;
  bankAccounts: readonly BankAccount[];
  selectableBankAccountIds: readonly string[];
  taxCategory: ApiReadResult<TaxableTaxCategory>;
}

export function getSavedInvoiceFieldContext(
  invoice: Invoice,
  options: InvoiceDetail["editOptions"],
): InvoiceDraftFieldContext {
  return {
    businessPartnerCode: invoice.businessPartner.code,
    addressee: invoice.businessPartner.snapshot.addressee,
    issueMonth: invoice.issueDate.slice(0, 7),
    bankAccounts: getBankAccountChoices(invoice, options.bankAccounts),
    selectableBankAccountIds: options.bankAccounts.map((account) => account.id),
    taxCategory: getEditingTaxCategory(invoice, options),
  };
}

export function createInvoiceDraftForm(invoice: Invoice): InvoiceDraftForm {
  return {
    issueDate: invoice.issueDate,
    transactionDate: invoice.transactionDate,
    paymentDueDate: invoice.paymentDueDate,
    honorific: invoice.businessPartner.snapshot.honorific,
    unitPricesIncludeTax: invoice.unitPricesIncludeTax,
    lineItems: invoice.lineItems.map(({ name, quantity, unit, unitPrice }) => ({
      name,
      quantity,
      unit,
      unitPrice,
    })),
    bankAccountIds: invoice.issuer.snapshot.bankAccounts.map(
      (account) => account.id,
    ),
    notes: invoice.notes ?? "",
    pdfFileNameOverride: invoice.pdf.fileNameOverride ?? "",
  };
}

export function hasInvoiceDraftChanges(
  invoice: Invoice,
  form: InvoiceDraftForm,
): boolean {
  return (
    JSON.stringify(createInvoiceDraftForm(invoice)) !== JSON.stringify(form)
  );
}

export function selectInvoiceBankAccount(
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

export function getEditingTaxCategory(
  invoice: Invoice,
  options: InvoiceDetail["editOptions"],
): ApiReadResult<TaxableTaxCategory> {
  try {
    const category =
      invoice.lineItems.length === 0
        ? selectCurrentStandardTaxCategory(options.taxCategories)
        : resolveInvoiceAmounts(invoice, options.taxCategories).taxCategory!;
    return { ok: true, value: category };
  } catch (error) {
    if (error instanceof DomainValidationError)
      return {
        ok: false,
        error: { message: error.message, issues: error.issues },
      };
    throw error;
  }
}

export function getBankAccountChoices(
  invoice: Invoice,
  currentAccounts: readonly BankAccount[],
): BankAccount[] {
  const accounts = new Map(
    invoice.issuer.snapshot.bankAccounts.map((account) => [
      account.id,
      account,
    ]),
  );
  for (const account of currentAccounts)
    if (!accounts.has(account.id)) accounts.set(account.id, account);
  return [...accounts.values()];
}

export function prepareInvoiceDraftUpdate(
  invoice: Invoice,
  form: InvoiceDraftForm,
  options: InvoiceDetail["editOptions"],
): ApiReadResult<{ invoice: Invoice; calculation: InvoiceCalculation }> {
  if (form.honorific === "")
    return {
      ok: false,
      error: {
        message: "敬称を選択してください。",
        issues: [
          {
            path: ["businessPartner", "snapshot", "honorific"],
            message: "敬称は必須です。",
          },
        ],
      },
    };
  const tax = getEditingTaxCategory(invoice, options);
  if (form.lineItems.length > 0 && !tax.ok) return tax;
  const choices = getBankAccountChoices(invoice, options.bankAccounts);
  const issues: DomainValidationIssue[] = form.bankAccountIds.flatMap(
    (id, index) =>
      choices.some((account) => account.id === id)
        ? []
        : [
            {
              path: ["issuer", "snapshot", "bankAccounts", index],
              message: `振込先 ${id} が見つかりません。`,
            },
          ],
  );
  const proposed: Invoice = {
    ...invoice,
    issueDate: form.issueDate,
    transactionDate: form.transactionDate,
    paymentDueDate: form.paymentDueDate,
    businessPartner: {
      ...invoice.businessPartner,
      snapshot: {
        ...invoice.businessPartner.snapshot,
        honorific: form.honorific,
      },
    },
    issuer: {
      ...invoice.issuer,
      snapshot: {
        ...invoice.issuer.snapshot,
        bankAccounts: form.bankAccountIds.flatMap((id) => {
          const account = choices.find((candidate) => candidate.id === id);
          return account ? [{ ...account }] : [];
        }),
      },
    },
    unitPricesIncludeTax: form.unitPricesIncludeTax,
    lineItems: form.lineItems.map((item) => ({
      ...item,
      quantity: item.quantity ?? NaN,
      unitPrice: item.unitPrice ?? NaN,
      taxCategoryId: tax.ok ? tax.value.id : "",
    })),
    notes: form.notes === "" ? null : form.notes,
    pdf: {
      ...invoice.pdf,
      fileNameOverride:
        form.pdfFileNameOverride === "" ? null : form.pdfFileNameOverride,
    },
  };
  issues.push(...validateInvoiceDraftContent(proposed, options.taxCategories));
  if (issues.length)
    return {
      ok: false,
      error: { message: "入力内容を確認してください。", issues },
    };
  return {
    ok: true,
    value: {
      invoice: proposed,
      calculation: resolveInvoiceAmounts(proposed, options.taxCategories)
        .calculation,
    },
  };
}

export function invoiceApiPath(invoiceNumber: string): string {
  return `/api/invoices/${encodeURIComponent(invoiceNumber)}`;
}
type InvoiceChange = { invoice: Invoice };

export async function saveInvoiceDraftForm(
  fetcher: typeof fetch,
  invoice: Invoice,
  form: InvoiceDraftForm,
  options: InvoiceDetail["editOptions"],
): Promise<ApiReadResult<InvoiceChange>> {
  const prepared = prepareInvoiceDraftUpdate(invoice, form, options);
  if (!prepared.ok) return prepared;
  return writeJsonApi(
    fetcher,
    invoiceApiPath(invoice.invoiceNumber),
    "PUT",
    prepared.value.invoice,
  );
}

export async function issueSavedInvoice(
  fetcher: typeof fetch,
  invoice: Invoice,
  form: InvoiceDraftForm,
  today: string,
): Promise<ApiReadResult<InvoiceChange>> {
  if (hasInvoiceDraftChanges(invoice, form))
    return {
      ok: false,
      error: {
        message: "未保存の変更があります。先に保存してください。",
        issues: [],
      },
    };
  const issues = validateInvoiceForIssue(invoice, today);
  if (issues.length)
    return {
      ok: false,
      error: { message: "請求書を発行できません。", issues },
    };
  return writeJsonApi(
    fetcher,
    `${invoiceApiPath(invoice.invoiceNumber)}/issue`,
    "POST",
    { revision: invoice.revision },
  );
}

export function revertSavedInvoice(
  fetcher: typeof fetch,
  invoice: Invoice,
): Promise<ApiReadResult<InvoiceChange>> {
  return writeJsonApi(
    fetcher,
    `${invoiceApiPath(invoice.invoiceNumber)}/revert-to-draft`,
    "POST",
    { revision: invoice.revision },
  );
}

export function deleteSavedInvoice(
  fetcher: typeof fetch,
  invoice: Invoice,
): Promise<ApiReadResult<unknown>> {
  return writeJsonApi(
    fetcher,
    invoiceApiPath(invoice.invoiceNumber),
    "DELETE",
    { revision: invoice.revision },
  );
}

export function saveInvoicePayment(
  fetcher: typeof fetch,
  invoice: Invoice,
  date: string,
  today: string,
): Promise<ApiReadResult<InvoiceChange>> {
  const issues = [
    ...validateInvoiceForPaymentManagement(invoice),
    ...validatePaymentCompletedDate(date, today),
  ];
  if (issues.length)
    return Promise.resolve({
      ok: false,
      error: { message: "入金完了日を記録できません。", issues },
    });
  return writeJsonApi(
    fetcher,
    `${invoiceApiPath(invoice.invoiceNumber)}/payment-completed-date`,
    "PUT",
    { revision: invoice.revision, paymentCompletedDate: date },
  );
}

export function deleteInvoicePayment(
  fetcher: typeof fetch,
  invoice: Invoice,
): Promise<ApiReadResult<InvoiceChange>> {
  return writeJsonApi(
    fetcher,
    `${invoiceApiPath(invoice.invoiceNumber)}/payment-completed-date`,
    "DELETE",
    { revision: invoice.revision },
  );
}
