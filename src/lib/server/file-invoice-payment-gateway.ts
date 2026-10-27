import { resolve } from "node:path";

import type { InvoicePaymentGateway } from "#lib/application/manage-invoice-payment";
import type { Invoice } from "#lib/domain/model";
import { invoiceSchema } from "#lib/persistence/schemas";
import { parseYaml } from "#lib/persistence/yaml-parser";
import { serializeInvoice } from "#lib/persistence/yaml-serializer";
import { writeTextFileAtomically } from "#lib/server/atomic-write";
import { loadKeiriData } from "#lib/server/keiri-data-loader";

export class FileInvoicePaymentGateway implements InvoicePaymentGateway {
  readonly #rootDirectory: string;

  constructor(rootDirectory: string) {
    this.#rootDirectory = rootDirectory;
  }

  async loadInvoice(invoiceNumber: string): Promise<Invoice | undefined> {
    const data = await loadKeiriData(this.#rootDirectory);
    return data.invoices.find(
      (record) => record.data.invoiceNumber === invoiceNumber,
    )?.data;
  }

  async saveInvoicePayment(
    currentInvoice: Invoice,
    updatedInvoice: Invoice,
  ): Promise<{ filePath: string }> {
    const filePath = `sales/invoices/${currentInvoice.invoiceDate.slice(0, 4)}/${currentInvoice.invoiceNumber}.yaml`;
    await writeTextFileAtomically(
      resolve(this.#rootDirectory, filePath),
      serializeInvoice(updatedInvoice),
      {
        overwrite: true,
        validate: (source) => {
          parseYaml(source, filePath, invoiceSchema);
        },
      },
    );
    return { filePath };
  }
}
