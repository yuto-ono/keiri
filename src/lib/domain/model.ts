export type Honorific = "様" | "御中";

export type RoundingMethod = "floor" | "halfUp" | "ceil";

export type AccountType = "ordinary" | "checking";

export type InvoiceStatus = "draft" | "issued";

export type MonthlyBillingStatus = "pending" | "completed";

export interface BankAccount {
  id: string;
  bankName: string;
  branchName: string;
  branchCode: string | null;
  accountType: AccountType;
  accountNumber: string;
  accountHolderName: string;
}

export interface BusinessPartner {
  revision: number;
  code: string;
  addressee: string;
  honorific: Honorific;
  requiresMonthlyInvoice: boolean;
  billingInstructions: string | null;
  unitPricesIncludeTax: boolean;
  issuerDisplay: {
    phone: boolean;
    email: boolean;
    bankAccountIds: string[];
  };
  pdfFileNamePattern: string;
}

export interface Issuer {
  revision: number;
  id: string;
  name: string;
  registrationNumber: string;
  phone: string | null;
  email: string | null;
  bankAccounts: BankAccount[];
  defaultBankAccountId: string;
}

interface TaxCategoryBase {
  id: string;
  name: string;
  deprecated: boolean;
}

export interface TaxableTaxCategory extends TaxCategoryBase {
  treatment: "taxable";
  isStandardRate: boolean;
  ratePercent: number;
}

export interface NonTaxableTaxCategory extends TaxCategoryBase {
  treatment: "nonTaxable" | "outOfScope" | "taxExempt";
}

export type TaxCategory = TaxableTaxCategory | NonTaxableTaxCategory;

export interface TaxCategories {
  revision: number;
  taxCategories: TaxCategory[];
}

export interface Settings {
  revision: number;
  rounding: InvoiceRounding;
}

export interface InvoiceRounding {
  lineAmount: RoundingMethod;
  taxAmount: RoundingMethod;
}

export interface InvoiceLineItem {
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  taxCategoryId: string;
}

export interface VisibleIssuerValue {
  visible: true;
  value: string;
}

export interface HiddenIssuerValue {
  visible: false;
}

export type IssuerContactSnapshot = VisibleIssuerValue | HiddenIssuerValue;

export interface Invoice {
  revision: number;
  status: InvoiceStatus;
  invoiceNumber: string;
  businessPartner: {
    code: string;
    snapshot: {
      addressee: string;
      honorific: Honorific;
    };
  };
  issuer: {
    id: string;
    snapshot: {
      name: string;
      registrationNumber: string;
      phone: IssuerContactSnapshot;
      email: IssuerContactSnapshot;
      bankAccounts: BankAccount[];
    };
  };
  invoiceDate: string;
  paymentDueDate: string;
  paymentCompletedDate: string | null;
  unitPricesIncludeTax: boolean;
  lineItems: InvoiceLineItem[];
  notes: string | null;
  rounding: InvoiceRounding;
  pdf: {
    fileNameOverride: string | null;
    issuedFileName: string | null;
  };
}
