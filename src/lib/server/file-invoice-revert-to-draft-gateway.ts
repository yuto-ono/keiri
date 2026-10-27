import { randomUUID } from "node:crypto";
import { readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import type { InvoiceRevertToDraftGateway } from "#lib/application/revert-invoice-to-draft";
import type { Invoice } from "#lib/domain/model";
import { invoiceSchema } from "#lib/persistence/schemas";
import { parseYaml } from "#lib/persistence/yaml-parser";
import { serializeInvoice } from "#lib/persistence/yaml-serializer";
import { stageFile, writeTextFileAtomically } from "#lib/server/atomic-write";
import { loadKeiriData } from "#lib/server/keiri-data-loader";

export class FileInvoiceRevertToDraftGateway implements InvoiceRevertToDraftGateway {
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

  async commitRevertedInvoice(
    currentInvoice: Invoice,
    draftInvoice: Invoice,
  ): Promise<{ invoiceFilePath: string; pdfFilePath: string }> {
    const issuedFileName = currentInvoice.pdf.issuedFileName;
    if (issuedFileName === null) {
      throw new Error("下書きへ戻す請求書の正式PDFファイル名がありません。");
    }
    const year = currentInvoice.invoiceDate.slice(0, 4);
    const invoiceFilePath = `sales/invoices/${year}/${currentInvoice.invoiceNumber}.yaml`;
    const pdfFilePath = `documents/${year}/sales/invoices/${currentInvoice.businessPartner.code}/${issuedFileName}`;
    const absoluteInvoicePath = resolve(this.#rootDirectory, invoiceFilePath);
    const absolutePdfPath = resolve(this.#rootDirectory, pdfFilePath);
    const originalContents = await readFile(absoluteInvoicePath, "utf8");
    const contents = serializeInvoice(draftInvoice);
    const validate = (source: string) => {
      parseYaml(source, invoiceFilePath, invoiceSchema);
    };
    validate(contents);
    const stagedInvoicePath = await stageFile(
      absoluteInvoicePath,
      Buffer.from(contents, "utf8"),
    );
    const temporaryPdfPath = join(
      dirname(absolutePdfPath),
      `.${basename(absolutePdfPath)}.${randomUUID()}.tmp`,
    );
    let pdfMoved = false;
    let invoiceReplaced = false;

    try {
      validate(await readFile(stagedInvoicePath, "utf8"));
      // PDFは同じディレクトリへ退避し、最後の破棄に失敗した場合も元へ戻せるようにする。
      await rename(absolutePdfPath, temporaryPdfPath);
      pdfMoved = true;
      await rename(stagedInvoicePath, absoluteInvoicePath);
      invoiceReplaced = true;
      await unlink(temporaryPdfPath);
    } catch (error) {
      try {
        if (invoiceReplaced) {
          await writeTextFileAtomically(absoluteInvoicePath, originalContents, {
            overwrite: true,
            validate,
          });
        }
      } finally {
        try {
          if (pdfMoved) {
            await rename(temporaryPdfPath, absolutePdfPath);
          }
        } finally {
          await removeIfExists(stagedInvoicePath);
        }
      }
      throw error;
    }

    return { invoiceFilePath, pdfFilePath };
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
