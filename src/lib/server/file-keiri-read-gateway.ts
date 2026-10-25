import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  KeiriReadData,
  KeiriReadGateway,
} from "#lib/application/read-keiri-data";
import type { Invoice } from "#lib/domain/model";
import { loadKeiriData } from "#lib/server/keiri-data-loader";

export class FileKeiriReadGateway implements KeiriReadGateway {
  readonly #rootDirectory: string;

  constructor(rootDirectory: string) {
    this.#rootDirectory = rootDirectory;
  }

  async loadData(): Promise<KeiriReadData> {
    const data = await loadKeiriData(this.#rootDirectory);
    return {
      invoices: data.invoices.map((record) => record.data),
      businessPartners: data.businessPartners.map((record) => record.data),
      issuers: data.issuers.map((record) => record.data),
      settings: data.settings.data,
      taxCategories: data.taxCategories.data.taxCategories,
    };
  }

  async readIssuedPdf(invoice: Invoice): Promise<Uint8Array> {
    if (invoice.status !== "issued" || invoice.pdf.issuedFileName === null) {
      throw new Error("発行済み請求書の正式PDFだけを取得できます。");
    }
    const filePath = `documents/${invoice.transactionDate.slice(0, 4)}/sales/invoices/${invoice.businessPartner.code}/${invoice.pdf.issuedFileName}`;
    return new Uint8Array(
      await readFile(resolve(this.#rootDirectory, filePath)),
    );
  }
}
