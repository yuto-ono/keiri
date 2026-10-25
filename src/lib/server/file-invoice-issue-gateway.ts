import { readFile, rename, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";

import { PDFDocument } from "pdf-lib";

import type {
  InvoiceIssueContext,
  InvoiceIssueGateway,
} from "#lib/application/issue-invoice";
import type { Invoice } from "#lib/domain/model";
import { invoiceSchema } from "#lib/persistence/schemas";
import { parseYaml } from "#lib/persistence/yaml-parser";
import { serializeInvoice } from "#lib/persistence/yaml-serializer";
import { stageFile } from "#lib/server/atomic-write";
import { loadKeiriData } from "#lib/server/keiri-data-loader";

export class FileInvoiceIssueGateway implements InvoiceIssueGateway {
  readonly #rootDirectory: string;

  constructor(rootDirectory: string) {
    this.#rootDirectory = rootDirectory;
  }

  async loadIssueContext(invoiceNumber: string): Promise<InvoiceIssueContext> {
    const data = await loadKeiriData(this.#rootDirectory);
    const invoice = data.invoices.find(
      (record) => record.data.invoiceNumber === invoiceNumber,
    )?.data;
    const businessPartner =
      invoice === undefined
        ? undefined
        : data.businessPartners.find(
            (record) => record.data.code === invoice.businessPartner.code,
          )?.data;
    return {
      invoice,
      businessPartner,
      taxCategories: data.taxCategories.data.taxCategories,
    };
  }

  async commitIssuedInvoice(
    currentInvoice: Invoice,
    issuedInvoice: Invoice,
    pdf: { fileName: string; contents: Uint8Array },
  ): Promise<{ invoiceFilePath: string; pdfFilePath: string }> {
    if (issuedInvoice.pdf.issuedFileName !== pdf.fileName) {
      throw new Error("請求書に記録するPDFファイル名と保存名が一致しません。");
    }

    const invoiceFilePath = invoicePath(currentInvoice);
    const pdfFilePath = issuedPdfPath(issuedInvoice, pdf.fileName);
    const absoluteInvoicePath = resolve(this.#rootDirectory, invoiceFilePath);
    const absolutePdfPath = resolve(this.#rootDirectory, pdfFilePath);
    const invoiceContents = serializeInvoice(issuedInvoice);
    parseYaml(invoiceContents, invoiceFilePath, invoiceSchema);
    await validateSinglePagePdf(pdf.contents);

    if (await pathExists(absolutePdfPath)) {
      throw new Error(`PDF保存先 ${pdfFilePath} は既に存在します。`);
    }

    const stagedInvoicePath = await stageFile(
      absoluteInvoicePath,
      Buffer.from(invoiceContents, "utf8"),
    );
    let stagedPdfPath: string | undefined;
    let publishedPdf = false;
    try {
      stagedPdfPath = await stageFile(absolutePdfPath, pdf.contents);
      const writtenInvoice = await readFile(stagedInvoicePath, "utf8");
      parseYaml(writtenInvoice, invoiceFilePath, invoiceSchema);
      const writtenPdf = await readFile(stagedPdfPath);
      await validateSinglePagePdf(writtenPdf);

      if (await pathExists(absolutePdfPath)) {
        throw new Error(`PDF保存先 ${pdfFilePath} は既に存在します。`);
      }
      await rename(stagedPdfPath, absolutePdfPath);
      stagedPdfPath = undefined;
      publishedPdf = true;
      await rename(stagedInvoicePath, absoluteInvoicePath);
      publishedPdf = false;
    } catch (error) {
      await removeIfExists(stagedInvoicePath);
      if (stagedPdfPath !== undefined) {
        await removeIfExists(stagedPdfPath);
      }
      if (publishedPdf) {
        await removeIfExists(absolutePdfPath);
      }
      throw error;
    }

    return { invoiceFilePath, pdfFilePath };
  }
}

function invoicePath(invoice: Invoice): string {
  return [
    "sales",
    "invoices",
    invoice.transactionDate.slice(0, 4),
    `${invoice.invoiceNumber}.yaml`,
  ].join("/");
}

function issuedPdfPath(invoice: Invoice, fileName: string): string {
  return [
    "documents",
    invoice.transactionDate.slice(0, 4),
    "sales",
    "invoices",
    invoice.businessPartner.code,
    fileName,
  ].join("/");
}

async function validateSinglePagePdf(contents: Uint8Array): Promise<void> {
  const document = await PDFDocument.load(contents);
  const pageCount = document.getPageCount();
  if (pageCount !== 1) {
    throw new Error(
      `請求書PDFは1ページである必要がありますが、${pageCount}ページあります。`,
    );
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
