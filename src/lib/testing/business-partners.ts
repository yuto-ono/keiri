import type {
  BusinessPartner,
  Invoice,
  InvoiceStatus,
  Issuer,
} from "#lib/domain/model";

export function createIssuer(): Issuer {
  return {
    revision: 1,
    id: "issuer",
    name: "発行者",
    registrationNumber: "T0000000000000",
    phone: "03-1234-5678",
    email: null,
    bankAccounts: ["primary", "secondary"].map((id, index) => ({
      id,
      bankName: `銀行${index + 1}`,
      branchName: "本店",
      branchCode: "001",
      accountType: "ordinary",
      accountNumber: "1234567",
      accountHolderName: "ハッコウシャ",
    })),
    defaultBankAccountId: "primary",
  };
}

export function createPartner(
  overrides: Partial<BusinessPartner> = {},
): BusinessPartner {
  return {
    revision: 1,
    code: "ACME",
    addressee: "株式会社サンプル",
    honorific: "御中",
    requiresMonthlyInvoice: true,
    billingInstructions: null,
    unitPricesIncludeTax: false,
    issuerDisplay: { phone: false, email: false, bankAccountIds: ["primary"] },
    pdfFileNamePattern: "{businessPartnerCode}-{issueDate:YYYYMM}-{sequence}",
    ...overrides,
  };
}

export function createInvoiceForPartner(
  partner = createPartner(),
  status: InvoiceStatus = "draft",
): Invoice {
  const issuer = createIssuer();
  const invoiceNumber = `${partner.code}-202610-01`;
  return {
    revision: 1,
    status,
    invoiceNumber,
    businessPartner: {
      code: partner.code,
      snapshot: { addressee: partner.addressee, honorific: partner.honorific },
    },
    issuer: {
      id: issuer.id,
      snapshot: {
        name: issuer.name,
        registrationNumber: issuer.registrationNumber,
        phone: { visible: false },
        email: { visible: false },
        bankAccounts: [issuer.bankAccounts[0]],
      },
    },
    issueDate: "2026-10-25",
    transactionDate: "2026-10-25",
    paymentDueDate: "2026-11-30",
    paymentCompletedDate: null,
    unitPricesIncludeTax: partner.unitPricesIncludeTax,
    lineItems: [
      {
        name: "業務",
        quantity: 1,
        unit: "式",
        unitPrice: 10_000,
        taxCategoryId: "standard-10",
      },
    ],
    notes: null,
    rounding: { lineAmount: "floor", taxAmount: "floor" },
    pdf: {
      fileNameOverride: null,
      issuedFileName: status === "issued" ? `${invoiceNumber}.pdf` : null,
    },
  };
}
