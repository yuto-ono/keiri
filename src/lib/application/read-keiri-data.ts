import { isBusinessDate, isBusinessDateAfter } from "#lib/domain/business-date";
import { resolveInvoiceAmounts } from "#lib/domain/invoice-calculation";
import { DomainValidationError } from "#lib/domain/domain-validation-error";
import { selectCurrentStandardTaxCategory } from "#lib/domain/tax-category";
import type {
  BusinessPartner,
  Invoice,
  Issuer,
  Settings,
  TaxCategory,
} from "#lib/domain/model";

export interface KeiriReadData {
  invoices: readonly Invoice[];
  businessPartners: readonly BusinessPartner[];
  issuers: readonly Issuer[];
  settings: Settings;
  taxCategories: readonly TaxCategory[];
}

export interface KeiriReadGateway {
  loadData(): Promise<KeiriReadData>;
  readIssuedPdf(invoice: Invoice): Promise<Uint8Array>;
}

export interface InvoiceListEntry extends Pick<
  Invoice,
  | "invoiceNumber"
  | "transactionDate"
  | "paymentDueDate"
  | "status"
  | "paymentCompletedDate"
> {
  addresseeWithHonorific: string;
  totalAmount: string;
}

export interface InvoiceListResult {
  year: string;
  years: string[];
  months: { month: string; invoices: InvoiceListEntry[] }[];
}

export async function listInvoices(
  gateway: KeiriReadGateway,
  input: { today: string; year?: string },
): Promise<InvoiceListResult> {
  if (!isBusinessDate(input.today)) {
    throw new RangeError(`現在日が不正です: ${input.today}`);
  }
  const currentYear = input.today.slice(0, 4);
  const year = input.year ?? currentYear;
  if (!/^\d{4}$/.test(year)) {
    throw new RangeError(`取引年が不正です: ${year}`);
  }
  const data = await gateway.loadData();
  const years = [
    ...new Set([
      currentYear,
      year,
      ...data.invoices.map((invoice) => invoice.transactionDate.slice(0, 4)),
    ]),
  ]
    .sort()
    .reverse();
  const invoices = data.invoices
    .filter((invoice) => invoice.transactionDate.slice(0, 4) === year)
    .toSorted((left, right) =>
      left.transactionDate === right.transactionDate
        ? 0
        : isBusinessDateAfter(left.transactionDate, right.transactionDate)
          ? -1
          : 1,
    );
  const months = new Map<string, InvoiceListEntry[]>();
  for (const invoice of invoices) {
    const month = invoice.transactionDate.slice(0, 7);
    const entries = months.get(month) ?? [];
    entries.push({
      invoiceNumber: invoice.invoiceNumber,
      transactionDate: invoice.transactionDate,
      paymentDueDate: invoice.paymentDueDate,
      status: invoice.status,
      paymentCompletedDate: invoice.paymentCompletedDate,
      addresseeWithHonorific: `${invoice.businessPartner.snapshot.addressee}${invoice.businessPartner.snapshot.honorific}`,
      totalAmount: resolveInvoiceAmounts(invoice, data.taxCategories)
        .calculation.totalAmount,
    });
    months.set(month, entries);
  }
  return {
    year,
    years,
    months: [...months].map(([month, entries]) => ({
      month,
      invoices: entries,
    })),
  };
}

export async function getInvoice(
  gateway: KeiriReadGateway,
  invoiceNumber: string,
) {
  const data = await gateway.loadData();
  const invoice = data.invoices.find(
    (candidate) => candidate.invoiceNumber === invoiceNumber,
  );
  return invoice === undefined
    ? undefined
    : {
        invoice,
        ...resolveInvoiceAmounts(invoice, data.taxCategories),
        editOptions: {
          bankAccounts:
            data.issuers.find((issuer) => issuer.id === invoice.issuer.id)
              ?.bankAccounts ?? [],
          taxCategories: data.taxCategories,
        },
      };
}

export type InvoiceDetail = NonNullable<Awaited<ReturnType<typeof getInvoice>>>;

export async function getInvoiceCreationData(
  gateway: KeiriReadGateway,
  sourceInvoiceNumber?: string,
) {
  const data = await gateway.loadData();
  const source =
    sourceInvoiceNumber === undefined
      ? undefined
      : data.invoices.find(
          (invoice) => invoice.invoiceNumber === sourceInvoiceNumber,
        );
  if (sourceInvoiceNumber !== undefined && source === undefined)
    return undefined;
  if (data.issuers.length !== 1) {
    throw new DomainValidationError("請求書を作成できません。", [
      { path: ["issuers"], message: "初期版の発行者は1件必要です。" },
    ]);
  }
  const currentTaxCategory = selectCurrentStandardTaxCategory(
    data.taxCategories,
  );
  return {
    businessPartners: data.businessPartners.toSorted((left, right) =>
      left.code < right.code ? -1 : left.code > right.code ? 1 : 0,
    ),
    issuer: data.issuers[0],
    rounding: data.settings.rounding,
    taxCategory:
      source === undefined
        ? currentTaxCategory
        : (resolveInvoiceAmounts(source, data.taxCategories).taxCategory ??
          currentTaxCategory),
    source:
      source === undefined
        ? null
        : {
            invoiceNumber: source.invoiceNumber,
            businessPartnerCode: source.businessPartner.code,
            lineItems: source.lineItems,
            notes: source.notes,
          },
  };
}

export type InvoiceCreationData = NonNullable<
  Awaited<ReturnType<typeof getInvoiceCreationData>>
>;

export async function listBusinessPartners(gateway: KeiriReadGateway) {
  const data = await gateway.loadData();
  return {
    businessPartners: data.businessPartners
      .toSorted((left, right) =>
        left.code < right.code ? -1 : left.code > right.code ? 1 : 0,
      )
      .map((partner) => ({
        code: partner.code,
        addresseeWithHonorific: `${partner.addressee}${partner.honorific}`,
        requiresMonthlyInvoice: partner.requiresMonthlyInvoice,
      })),
  };
}

export async function getBusinessPartner(
  gateway: KeiriReadGateway,
  code: string,
) {
  const data = await gateway.loadData();
  const businessPartner = data.businessPartners.find(
    (partner) => partner.code === code,
  );
  return businessPartner === undefined
    ? undefined
    : {
        businessPartner,
        hasInvoiceReferences: data.invoices.some(
          (invoice) => invoice.businessPartner.code === code,
        ),
      };
}

export async function listIssuers(gateway: KeiriReadGateway) {
  return { issuers: (await gateway.loadData()).issuers };
}

export async function getIssuer(gateway: KeiriReadGateway, id: string) {
  const issuer = (await gateway.loadData()).issuers.find(
    (issuer) => issuer.id === id,
  );
  return issuer === undefined ? undefined : { issuer };
}

export async function getSettings(gateway: KeiriReadGateway) {
  return { settings: (await gateway.loadData()).settings };
}

export async function getInvoicePdf(
  gateway: KeiriReadGateway,
  invoiceNumber: string,
): Promise<{ fileName: string; contents: Uint8Array } | undefined> {
  const invoice = (await gateway.loadData()).invoices.find(
    (invoice) => invoice.invoiceNumber === invoiceNumber,
  );
  if (
    invoice === undefined ||
    invoice.status !== "issued" ||
    invoice.pdf.issuedFileName === null
  ) {
    return undefined;
  }
  return {
    fileName: invoice.pdf.issuedFileName,
    contents: await gateway.readIssuedPdf(invoice),
  };
}
