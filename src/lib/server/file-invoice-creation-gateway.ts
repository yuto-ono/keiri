import { resolve } from "node:path";

import type {
  InvoiceCreationContext,
  InvoiceCreationGateway,
} from "../application/create-invoice-draft";
import type { Invoice } from "../domain/model";
import { invoiceSchema } from "../persistence/schemas";
import { parseYaml } from "../persistence/yaml-parser";
import { serializeInvoice } from "../persistence/yaml-serializer";
import { writeTextFileAtomically } from "./atomic-write";
import { loadKeiriData } from "./keiri-data-loader";

export class FileInvoiceCreationGateway implements InvoiceCreationGateway {
  readonly #rootDirectory: string;

  constructor(rootDirectory: string) {
    this.#rootDirectory = rootDirectory;
  }

  async loadCreationContext(): Promise<InvoiceCreationContext> {
    const data = await loadKeiriData(this.#rootDirectory);
    return {
      businessPartners: data.businessPartners.map((record) => record.data),
      issuers: data.issuers.map((record) => record.data),
      taxCategories: data.taxCategories.data.taxCategories,
      settings: data.settings.data,
      invoices: data.invoices.map((record) => record.data),
    };
  }

  async saveNewInvoice(invoice: Invoice): Promise<{ filePath: string }> {
    const filePath = [
      "sales",
      "invoices",
      invoice.transactionDate.slice(0, 4),
      `${invoice.invoiceNumber}.yaml`,
    ].join("/");
    const contents = serializeInvoice(invoice);
    await writeTextFileAtomically(
      resolve(this.#rootDirectory, filePath),
      contents,
      {
        overwrite: false,
        validate: (writtenContents) => {
          parseYaml(writtenContents, filePath, invoiceSchema);
        },
      },
    );
    return { filePath };
  }
}
