import { resolve } from "node:path";

import type {
  InvoiceUpdateContext,
  InvoiceUpdateGateway,
} from "#lib/application/update-invoice-draft";
import type { Invoice } from "#lib/domain/model";
import { invoiceSchema } from "#lib/persistence/schemas";
import { parseYaml } from "#lib/persistence/yaml-parser";
import { serializeInvoice } from "#lib/persistence/yaml-serializer";
import { moveTextFileAtomically } from "#lib/server/atomic-write";
import { loadKeiriData } from "#lib/server/keiri-data-loader";

export class FileInvoiceUpdateGateway implements InvoiceUpdateGateway {
  readonly #rootDirectory: string;

  constructor(rootDirectory: string) {
    this.#rootDirectory = rootDirectory;
  }

  async loadUpdateContext(
    invoiceNumber: string,
  ): Promise<InvoiceUpdateContext> {
    const data = await loadKeiriData(this.#rootDirectory);
    const invoice = data.invoices.find(
      (record) => record.data.invoiceNumber === invoiceNumber,
    )?.data;
    const issuer =
      invoice === undefined
        ? undefined
        : data.issuers.find((record) => record.data.id === invoice.issuer.id)
            ?.data;
    return {
      invoice,
      issuer,
      taxCategories: data.taxCategories.data.taxCategories,
    };
  }

  async saveUpdatedInvoice(
    currentInvoice: Invoice,
    updatedInvoice: Invoice,
  ): Promise<{ filePath: string }> {
    const currentFilePath = invoiceFilePath(currentInvoice);
    const updatedFilePath = invoiceFilePath(updatedInvoice);
    const contents = serializeInvoice(updatedInvoice);
    await moveTextFileAtomically(
      resolve(this.#rootDirectory, currentFilePath),
      resolve(this.#rootDirectory, updatedFilePath),
      contents,
      (writtenContents) => {
        parseYaml(writtenContents, updatedFilePath, invoiceSchema);
      },
    );
    return { filePath: updatedFilePath };
  }
}

function invoiceFilePath(invoice: Invoice): string {
  return [
    "sales",
    "invoices",
    invoice.transactionDate.slice(0, 4),
    `${invoice.invoiceNumber}.yaml`,
  ].join("/");
}
