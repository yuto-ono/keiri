import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InvoicePdfRenderer } from "#lib/application/issue-invoice";
import { regenerateInvoicePdf } from "#lib/application/regenerate-invoice-pdf";
import type { Invoice } from "#lib/domain/model";
import {
  serializeBusinessPartner,
  serializeInvoice,
  serializeIssuer,
} from "#lib/persistence/yaml-serializer";
import {
  createInvoiceForPartner,
  createIssuer,
  createPartner,
} from "#lib/testing/business-partners";
import { stageFile } from "./atomic-write";
import { FileInvoicePdfRegenerationGateway } from "./file-invoice-pdf-regeneration-gateway";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
vi.mock("./atomic-write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./atomic-write")>();
  return { ...actual, stageFile: vi.fn(actual.stageFile) };
});
// 保存処理の失敗を独立して再現する。実際のPDF生成はレンダラーの結合テストで確認する。
vi.mock("pdf-lib", () => ({ PDFDocument: { load: vi.fn() } }));

const actualFileSystem =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const actualAtomicWrite =
  await vi.importActual<typeof import("./atomic-write")>("./atomic-write");
let dataRoot: string;
let invoice: Invoice;
let invoicePath: string;
let pdfPath: string;
let originalYaml: string;
const originalPdf = Buffer.from("元の正式PDF");
const newPdf = Buffer.from("新しい正式PDF");

beforeEach(async () => {
  vi.mocked(rename).mockReset().mockImplementation(actualFileSystem.rename);
  vi.mocked(stageFile)
    .mockReset()
    .mockImplementation(actualAtomicWrite.stageFile);
  vi.mocked(PDFDocument.load).mockReset().mockResolvedValue({
    getPageCount: () => 1,
  } as Awaited<ReturnType<typeof PDFDocument.load>>);
  dataRoot = await mkdtemp(join(tmpdir(), "keiri-regenerate-pdf-"));
  await cp(resolve("templates/keiri-data"), dataRoot, { recursive: true });
  await unlink(join(dataRoot, "issuers/your-issuer-id.yaml"));
  await writeFile(
    join(dataRoot, "issuers/issuer.yaml"),
    serializeIssuer(createIssuer()),
  );
  await writeFile(
    join(dataRoot, "business-partners/ACME.yaml"),
    serializeBusinessPartner(createPartner()),
  );
  invoice = createInvoiceForPartner(undefined, "issued");
  invoice.transactionDate = "2025-12-31";
  invoice.pdf = { fileNameOverride: "別の指定名", issuedFileName: "保存済み.pdf" };
  invoicePath = join(dataRoot, "sales/invoices/2025/ACME-202610-01.yaml");
  pdfPath = join(dataRoot, "documents/2025/sales/invoices/ACME/保存済み.pdf");
  await mkdir(dirname(invoicePath), { recursive: true });
  await mkdir(dirname(pdfPath), { recursive: true });
  await saveOriginalInvoice();
  await writeFile(pdfPath, originalPdf);
});

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true });
});

async function saveOriginalInvoice() {
  originalYaml = `# 再生成で書式も変更しない\r\n${serializeInvoice(invoice).replaceAll("\n", "\r\n")}`;
  await writeFile(invoicePath, originalYaml);
}

function regenerate(render?: InvoicePdfRenderer["renderSinglePagePdf"]) {
  const renderSinglePagePdf = vi.fn<InvoicePdfRenderer["renderSinglePagePdf"]>(
    render ?? (async () => newPdf),
  );
  const result = regenerateInvoicePdf(
    new FileInvoicePdfRegenerationGateway(dataRoot),
    { renderSinglePagePdf },
    invoice.invoiceNumber,
  );
  return { result, renderSinglePagePdf };
}

async function expectOriginalFiles() {
  expect(await readFile(invoicePath, "utf8")).toBe(originalYaml);
  expect(await readFile(pdfPath)).toEqual(originalPdf);
  expect(await readdir(dirname(invoicePath))).toEqual(["ACME-202610-01.yaml"]);
  expect(await readdir(dirname(pdfPath))).toEqual(["保存済み.pdf"]);
}

describe("正式PDFだけを差し替えるファイルgateway", () => {
  it.each([false, true])("税込設定 %s で入金済みの請求書を同じパスへ繰り返し再生成する", async (inclusive) => {
    invoice.unitPricesIncludeTax = inclusive;
    invoice.paymentCompletedDate = "2026-10-26";
    await saveOriginalInvoice();
    await writeFile(
      join(dataRoot, "business-partners/ACME.yaml"),
      serializeBusinessPartner(createPartner({
        addressee: "登録情報の変更後",
        pdfFileNamePattern: "変更後-{sequence}",
      })),
    );
    const issuer = createIssuer();
    issuer.name = "発行者の変更後";
    issuer.bankAccounts[0].branchName = "変更後支店";
    await writeFile(join(dataRoot, "issuers/issuer.yaml"), serializeIssuer(issuer));

    for (const contents of [newPdf, Buffer.from("2回目のPDF")]) {
      const run = regenerate(async () => contents);
      await expect(run.result).resolves.toEqual({
        invoice,
        pdfFilePath: "documents/2025/sales/invoices/ACME/保存済み.pdf",
      });
      expect(run.renderSinglePagePdf.mock.calls[0][0].invoice).toEqual(invoice);
      expect(await readFile(invoicePath, "utf8")).toBe(originalYaml);
      expect(await readFile(pdfPath)).toEqual(contents);
      expect(PDFDocument.load).toHaveBeenLastCalledWith(contents);
      expect(await readdir(dirname(pdfPath))).toEqual(["保存済み.pdf"]);
    }
  });

  it.each(["生成", "一時書き込み", "PDF解析", "ページ数", "rename"])(
    "%s の失敗では元のPDFとYAMLを維持し一時ファイルを残さない",
    async (phase) => {
      const failure = new Error(`${phase}に失敗しました。`);
      if (phase === "一時書き込み") {
        vi.mocked(stageFile).mockRejectedValueOnce(failure);
      } else if (phase === "PDF解析") {
        vi.mocked(PDFDocument.load).mockRejectedValueOnce(failure);
      } else if (phase === "ページ数") {
        vi.mocked(PDFDocument.load).mockResolvedValueOnce({
          getPageCount: () => 2,
        } as Awaited<ReturnType<typeof PDFDocument.load>>);
      } else if (phase === "rename") {
        vi.mocked(rename).mockRejectedValueOnce(failure);
      }
      const run = regenerate(async () => {
        if (phase === "生成") throw failure;
        return newPdf;
      });
      await expect(run.result).rejects.toThrow(
        phase === "ページ数" ? "2ページあります" : failure.message,
      );
      await expectOriginalFiles();
    },
  );

  it.each(["revision", "status", "fileName", "year", "partner"])(
    "置換直前に %s の変更を検出してPDFを維持する",
    async (field) => {
      // 一時PDFの検証中に変更し、検証後にもYAMLを読み直すことを確認する。
      vi.mocked(PDFDocument.load).mockImplementationOnce(async () => {
        const changed = structuredClone(invoice);
        if (field === "revision") changed.revision += 1;
        if (field === "status") {
          changed.status = "draft";
          changed.pdf.issuedFileName = null;
        }
        if (field === "fileName") changed.pdf.issuedFileName = "変更後.pdf";
        if (field === "year") changed.transactionDate = "2026-01-01";
        if (field === "partner") changed.businessPartner.code = "OTHER";
        originalYaml = serializeInvoice(changed);
        await writeFile(invoicePath, originalYaml);
        return { getPageCount: () => 1 } as Awaited<ReturnType<typeof PDFDocument.load>>;
      });
      await expect(regenerate().result).rejects.toThrow();
      await expectOriginalFiles();
      expect(rename).not.toHaveBeenCalled();
    },
  );

  it("開始時に正式PDFがなければ生成を開始しない", async () => {
    await unlink(pdfPath);
    const run = regenerate();
    await expect(run.result).rejects.toThrow();
    expect(run.renderSinglePagePdf).not.toHaveBeenCalled();
    expect(await readFile(invoicePath, "utf8")).toBe(originalYaml);
    expect(await readdir(dirname(pdfPath))).toEqual([]);
  });

  it("生成中に正式PDFがなくなった場合は再作成せず一時ファイルを除去する", async () => {
    const run = regenerate(async () => {
      await unlink(pdfPath);
      return newPdf;
    });
    await expect(run.result).rejects.toMatchObject({ code: "ENOENT" });
    expect(rename).not.toHaveBeenCalled();
    expect(await readFile(invoicePath, "utf8")).toBe(originalYaml);
    expect(await readdir(dirname(pdfPath))).toEqual([]);
  });
});
