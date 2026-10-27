import { readFile, rename, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";

import { PDFDocument } from "pdf-lib";

import type {
  InvoicePdfRegenerationContext,
  InvoicePdfRegenerationGateway,
} from "#lib/application/regenerate-invoice-pdf";
import type { Invoice } from "#lib/domain/model";
import { invoiceSchema } from "#lib/persistence/schemas";
import { parseYaml } from "#lib/persistence/yaml-parser";
import { stageFile } from "#lib/server/atomic-write";
import { loadKeiriData } from "#lib/server/keiri-data-loader";

export class FileInvoicePdfRegenerationGateway implements InvoicePdfRegenerationGateway {
  readonly #rootDirectory: string;

  constructor(rootDirectory: string) {
    this.#rootDirectory = rootDirectory;
  }

  async loadRegenerationContext(
    invoiceNumber: string,
  ): Promise<InvoicePdfRegenerationContext> {
    const data = await loadKeiriData(this.#rootDirectory);
    return {
      invoice: data.invoices.find(
        (record) => record.data.invoiceNumber === invoiceNumber,
      )?.data,
      taxCategories: data.taxCategories.data.taxCategories,
    };
  }

  async replaceIssuedPdf(
    invoice: Invoice,
    contents: Uint8Array,
  ): Promise<{ pdfFilePath: string }> {
    const pdfFilePath = issuedPdfPath(invoice);
    const absolutePdfPath = resolve(this.#rootDirectory, pdfFilePath);
    const year = invoice.invoiceDate.slice(0, 4);
    const invoiceFilePath = `sales/invoices/${year}/${invoice.invoiceNumber}.yaml`;
    const stagedPdfPath = await stageFile(absolutePdfPath, contents);
    try {
      const writtenPdf = await readFile(stagedPdfPath);
      const document = await PDFDocument.load(writtenPdf);
      const pageCount = document.getPageCount();
      if (pageCount !== 1) {
        throw new Error(
          `請求書PDFは1ページである必要がありますが、${pageCount}ページあります。`,
        );
      }

      const currentInvoice = parseYaml(
        await readFile(resolve(this.#rootDirectory, invoiceFilePath), "utf8"),
        invoiceFilePath,
        invoiceSchema,
      );
      if (
        currentInvoice.invoiceNumber !== invoice.invoiceNumber ||
        currentInvoice.status !== "issued" ||
        currentInvoice.revision !== invoice.revision ||
        issuedPdfPath(currentInvoice) !== pdfFilePath
      ) {
        throw new Error("生成中に請求書が変更されたため、PDFを置き換えられません。");
      }
      const existingPdf = await stat(absolutePdfPath);
      if (!existingPdf.isFile()) {
        throw new Error(`正式PDF ${pdfFilePath} がファイルではありません。`);
      }
      await rename(stagedPdfPath, absolutePdfPath);
    } catch (error) {
      await removeIfExists(stagedPdfPath);
      throw error;
    }
    return { pdfFilePath };
  }
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    )) {
      throw error;
    }
  }
}

function issuedPdfPath(invoice: Invoice): string {
  if (invoice.status !== "issued" || invoice.pdf.issuedFileName === null) {
    throw new Error("正式PDFが記録された発行済み請求書ではありません。");
  }
  return [
    "documents",
    invoice.invoiceDate.slice(0, 4),
    "sales",
    "invoices",
    invoice.businessPartner.code,
    invoice.pdf.issuedFileName,
  ].join("/");
}
