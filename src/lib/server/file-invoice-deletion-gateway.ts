import { unlink } from "node:fs/promises";
import { resolve } from "node:path";

import type { InvoiceDeletionGateway } from "#lib/application/delete-invoice-draft";
import type { Invoice } from "#lib/domain/model";
import { loadKeiriData } from "#lib/server/keiri-data-loader";

export class FileInvoiceDeletionGateway implements InvoiceDeletionGateway {
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

  async deleteInvoice(invoice: Invoice): Promise<{ filePath: string }> {
    const filePath = `sales/invoices/${invoice.invoiceDate.slice(0, 4)}/${invoice.invoiceNumber}.yaml`;
    await unlink(resolve(this.#rootDirectory, filePath));
    return { filePath };
  }
}
