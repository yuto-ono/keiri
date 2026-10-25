import type { KeiriReadData } from "#lib/application/read-keiri-data";
import {
  createInvoiceForPartner,
  createIssuer,
  createPartner,
} from "#lib/testing/business-partners";

export function createReadData(): KeiriReadData {
  return {
    invoices: [createInvoiceForPartner()],
    businessPartners: [createPartner()],
    issuers: [createIssuer()],
    settings: {
      revision: 1,
      rounding: { lineAmount: "floor", taxAmount: "floor" },
    },
    taxCategories: [
      {
        id: "standard-10",
        name: "標準10%",
        treatment: "taxable",
        deprecated: false,
        isStandardRate: true,
        ratePercent: 10,
      },
    ],
  };
}
