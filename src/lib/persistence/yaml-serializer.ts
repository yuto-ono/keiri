import { stringify } from "yaml";

import type {
  BankAccount,
  BusinessPartner,
  Invoice,
  Issuer,
  IssuerContactSnapshot,
  Settings,
  TaxCategories,
  TaxCategory,
} from "#lib/domain/model";

export function serializeBusinessPartner(value: BusinessPartner): string {
  return stringifyYaml({
    revision: value.revision,
    code: value.code,
    addressee: value.addressee,
    honorific: value.honorific,
    requiresMonthlyInvoice: value.requiresMonthlyInvoice,
    billingInstructions: value.billingInstructions,
    unitPricesIncludeTax: value.unitPricesIncludeTax,
    issuerDisplay: {
      phone: value.issuerDisplay.phone,
      email: value.issuerDisplay.email,
      bankAccountIds: value.issuerDisplay.bankAccountIds,
    },
    pdfFileNamePattern: value.pdfFileNamePattern,
  });
}

export function serializeIssuer(value: Issuer): string {
  return stringifyYaml({
    revision: value.revision,
    id: value.id,
    name: value.name,
    registrationNumber: value.registrationNumber,
    phone: value.phone,
    email: value.email,
    bankAccounts: value.bankAccounts.map(orderBankAccount),
    defaultBankAccountId: value.defaultBankAccountId,
  });
}

export function serializeTaxCategories(value: TaxCategories): string {
  return stringifyYaml({
    revision: value.revision,
    taxCategories: value.taxCategories.map(orderTaxCategory),
  });
}

export function serializeSettings(value: Settings): string {
  return stringifyYaml({
    revision: value.revision,
    rounding: {
      lineAmount: value.rounding.lineAmount,
      taxAmount: value.rounding.taxAmount,
    },
  });
}

export function serializeInvoice(value: Invoice): string {
  return stringifyYaml({
    revision: value.revision,
    status: value.status,
    invoiceNumber: value.invoiceNumber,
    businessPartner: {
      code: value.businessPartner.code,
      snapshot: {
        addressee: value.businessPartner.snapshot.addressee,
        honorific: value.businessPartner.snapshot.honorific,
      },
    },
    issuer: {
      id: value.issuer.id,
      snapshot: {
        name: value.issuer.snapshot.name,
        registrationNumber: value.issuer.snapshot.registrationNumber,
        phone: orderIssuerContact(value.issuer.snapshot.phone),
        email: orderIssuerContact(value.issuer.snapshot.email),
        bankAccounts: value.issuer.snapshot.bankAccounts.map(orderBankAccount),
      },
    },
    issueDate: value.issueDate,
    transactionDate: value.transactionDate,
    paymentDueDate: value.paymentDueDate,
    paymentCompletedDate: value.paymentCompletedDate,
    unitPricesIncludeTax: value.unitPricesIncludeTax,
    lineItems: value.lineItems.map((lineItem) => ({
      name: lineItem.name,
      quantity: lineItem.quantity,
      unit: lineItem.unit,
      unitPrice: lineItem.unitPrice,
      taxCategoryId: lineItem.taxCategoryId,
    })),
    notes: value.notes,
    rounding: {
      lineAmount: value.rounding.lineAmount,
      taxAmount: value.rounding.taxAmount,
    },
    pdf: {
      fileNameOverride: value.pdf.fileNameOverride,
      issuedFileName: value.pdf.issuedFileName,
    },
  });
}

function orderBankAccount(value: BankAccount) {
  return {
    id: value.id,
    bankName: value.bankName,
    branchName: value.branchName,
    branchCode: value.branchCode,
    accountType: value.accountType,
    accountNumber: value.accountNumber,
    accountHolderName: value.accountHolderName,
  };
}

function orderTaxCategory(value: TaxCategory) {
  if (value.treatment === "taxable") {
    return {
      id: value.id,
      name: value.name,
      treatment: value.treatment,
      deprecated: value.deprecated,
      isStandardRate: value.isStandardRate,
      ratePercent: value.ratePercent,
    };
  }

  return {
    id: value.id,
    name: value.name,
    treatment: value.treatment,
    deprecated: value.deprecated,
  };
}

function orderIssuerContact(value: IssuerContactSnapshot) {
  return value.visible
    ? { visible: true as const, value: value.value }
    : { visible: false as const };
}

function stringifyYaml(value: unknown): string {
  const normalized = normalizeMultilineStrings(value);
  return stringify(normalized, {
    schema: "core",
    indent: 2,
    lineWidth: 0,
    blockQuote: "literal",
    directives: false,
    aliasDuplicateObjects: false,
  })
    .replace(/\r\n?/g, "\n")
    .replace(/\n*$/, "\n");
}

function normalizeMultilineStrings(value: unknown): unknown {
  if (typeof value === "string") {
    if (!/[\r\n]/.test(value)) {
      return value;
    }
    return value.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  }
  if (Array.isArray(value)) {
    return value.map(normalizeMultilineStrings);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        normalizeMultilineStrings(child),
      ]),
    );
  }
  return value;
}
