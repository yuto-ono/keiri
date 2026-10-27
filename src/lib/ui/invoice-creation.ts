import type { InvoiceCreationData } from "#lib/application/read-keiri-data";
import type { InvoiceDraftFormContent } from "#lib/application/create-invoice-draft";
import { validateInvoiceDraftContent } from "#lib/domain/invoice-draft-content";
import { DomainValidationError } from "#lib/domain/domain-validation-error";
import {
  resolveInvoiceAmounts,
  type InvoiceCalculation,
} from "#lib/domain/invoice-calculation";
import type { Invoice } from "#lib/domain/model";
import {
  invoiceApiPath,
  type InvoiceDraftForm,
  type InvoiceDraftFieldContext,
} from "#lib/ui/invoice-editor";
import type { ApiReadResult, ApiIssue } from "#lib/ui/read-api";
import { writeJsonApi } from "#lib/ui/write-api";

export interface InvoiceCreationScreenData extends InvoiceCreationData {
  today: string;
}
export interface UnsavedInvoiceForm extends InvoiceDraftForm {
  businessPartnerCode: string;
}

export function createUnsavedInvoiceForm(
  data: InvoiceCreationScreenData,
): UnsavedInvoiceForm {
  const form: UnsavedInvoiceForm = {
    businessPartnerCode: "",
    invoiceDate: data.today,
    paymentDueDate: "",
    honorific: "",
    unitPricesIncludeTax: false,
    bankAccountIds: [],
    lineItems:
      data.source?.lineItems.map(({ name, quantity, unit, unitPrice }) => ({
        name,
        quantity,
        unit,
        unitPrice,
      })) ?? [],
    notes: data.source?.notes ?? "",
    pdfFileNameOverride: "",
  };
  return data.source === null
    ? form
    : changeUnsavedInvoicePartner(form, data.source.businessPartnerCode, data);
}

export function changeUnsavedInvoicePartner(
  form: UnsavedInvoiceForm,
  code: string,
  data: InvoiceCreationScreenData,
): UnsavedInvoiceForm {
  const partner = data.businessPartners.find(
    (candidate) => candidate.code === code,
  );
  return {
    ...form,
    businessPartnerCode: code,
    honorific: partner?.honorific ?? "",
    unitPricesIncludeTax: partner?.unitPricesIncludeTax ?? false,
    bankAccountIds: [...(partner?.issuerDisplay.bankAccountIds ?? [])],
  };
}

export function getUnsavedInvoiceFieldContext(
  form: UnsavedInvoiceForm,
  data: InvoiceCreationScreenData,
): InvoiceDraftFieldContext {
  const partner = data.businessPartners.find(
    (candidate) => candidate.code === form.businessPartnerCode,
  );
  return {
    businessPartnerCode: partner?.code ?? "",
    addressee: partner?.addressee ?? "",
    invoiceMonth: null,
    bankAccounts: data.issuer.bankAccounts,
    selectableBankAccountIds: data.issuer.bankAccounts.map(
      (account) => account.id,
    ),
    taxCategory: { ok: true, value: data.taxCategory },
  };
}

export function getUnsavedIssuerSnapshot(
  form: UnsavedInvoiceForm,
  data: InvoiceCreationScreenData,
): Invoice["issuer"]["snapshot"] {
  const partner = data.businessPartners.find(
    (candidate) => candidate.code === form.businessPartnerCode,
  );
  return {
    name: data.issuer.name,
    registrationNumber: data.issuer.registrationNumber,
    phone:
      partner?.issuerDisplay.phone && data.issuer.phone !== null
        ? { visible: true, value: data.issuer.phone }
        : { visible: false },
    email:
      partner?.issuerDisplay.email && data.issuer.email !== null
        ? { visible: true, value: data.issuer.email }
        : { visible: false },
    bankAccounts: [],
  };
}

function getUnsavedLineItems(
  form: UnsavedInvoiceForm,
  data: InvoiceCreationScreenData,
) {
  return form.lineItems.map((item) => ({
    ...item,
    quantity: item.quantity ?? NaN,
    unitPrice: item.unitPrice ?? NaN,
    taxCategoryId: data.taxCategory.id,
  }));
}

export function previewUnsavedInvoice(
  form: UnsavedInvoiceForm,
  data: InvoiceCreationScreenData,
): ApiReadResult<InvoiceCalculation> {
  try {
    return {
      ok: true,
      value: resolveInvoiceAmounts(
        {
          lineItems: getUnsavedLineItems(form, data),
          unitPricesIncludeTax: form.unitPricesIncludeTax,
          rounding: data.rounding,
        },
        [data.taxCategory],
      ).calculation,
    };
  } catch (error) {
    if (error instanceof DomainValidationError)
      return {
        ok: false,
        error: { message: error.message, issues: error.issues },
      };
    throw error;
  }
}

export function prepareUnsavedInvoice(
  form: UnsavedInvoiceForm,
  data: InvoiceCreationScreenData,
): ApiReadResult<{
  body: {
    businessPartnerCode: string;
    invoiceDate: string;
    paymentDueDate: string;
    content: InvoiceDraftFormContent;
  };
  calculation: InvoiceCalculation;
}> {
  const issues: ApiIssue[] = [];
  if (
    !data.businessPartners.some(
      (partner) => partner.code === form.businessPartnerCode,
    )
  )
    issues.push({
      path: ["businessPartnerCode"],
      message: "取引先を選択してください。",
    });
  if (form.honorific === "")
    issues.push({
      path: ["content", "honorific"],
      message: "敬称を選択してください。",
    });
  const seenIds = new Set<string>();
  form.bankAccountIds.forEach((id, index) => {
    if (
      seenIds.has(id) ||
      !data.issuer.bankAccounts.some((account) => account.id === id)
    )
      issues.push({
        path: ["content", "bankAccountIds", index],
        message: `振込先 ${id} の選択が不正です。`,
      });
    seenIds.add(id);
  });
  const lineItems = getUnsavedLineItems(form, data);
  const pdfFileNameOverride =
    form.pdfFileNameOverride === "" ? null : form.pdfFileNameOverride;
  const draftContent = {
    invoiceDate: form.invoiceDate,
    paymentDueDate: form.paymentDueDate,
    unitPricesIncludeTax: form.unitPricesIncludeTax,
    lineItems,
    rounding: data.rounding,
    pdf: { fileNameOverride: pdfFileNameOverride },
  };
  issues.push(...validateInvoiceDraftContent(draftContent, [data.taxCategory]));
  if (issues.length || form.honorific === "")
    return {
      ok: false,
      error: { message: "入力内容を確認してください。", issues },
    };
  return {
    ok: true,
    value: {
      body: {
        businessPartnerCode: form.businessPartnerCode,
        invoiceDate: form.invoiceDate,
        paymentDueDate: form.paymentDueDate,
        content: {
          honorific: form.honorific,
          unitPricesIncludeTax: form.unitPricesIncludeTax,
          bankAccountIds: [...form.bankAccountIds],
          lineItems,
          notes: form.notes === "" ? null : form.notes,
          pdfFileNameOverride,
        },
      },
      calculation: resolveInvoiceAmounts(draftContent, [data.taxCategory])
        .calculation,
    },
  };
}

export async function saveUnsavedInvoice(
  fetcher: typeof fetch,
  form: UnsavedInvoiceForm,
  data: InvoiceCreationScreenData,
): Promise<ApiReadResult<{ invoice: Invoice }>> {
  const prepared = prepareUnsavedInvoice(form, data);
  if (!prepared.ok) return prepared;
  const url =
    data.source === null
      ? "/api/invoices"
      : `${invoiceApiPath(data.source.invoiceNumber)}/duplicate`;
  return writeJsonApi(fetcher, url, "POST", prepared.value.body);
}
