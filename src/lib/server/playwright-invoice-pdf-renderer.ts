import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PDFDocument } from "pdf-lib";
import { chromium } from "playwright";

import type {
  InvoicePdfRenderer,
  InvoicePdfRenderInput,
} from "#lib/application/issue-invoice";
import { buildInvoicePdfHtml } from "#lib/server/invoice-pdf-template";

const FONT_RELATIVE_PATH = "static/fonts/noto-sans-jp/NotoSansJP-VF.ttf";

export class PlaywrightInvoicePdfRenderer implements InvoicePdfRenderer {
  readonly #fontPath: string;

  constructor(repositoryRoot: string) {
    this.#fontPath = resolve(repositoryRoot, FONT_RELATIVE_PATH);
  }

  async renderSinglePagePdf(input: InvoicePdfRenderInput): Promise<Uint8Array> {
    const font = await readFile(this.#fontPath);
    const fontDataUrl = `data:font/ttf;base64,${font.toString("base64")}`;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(buildInvoicePdfHtml(input, fontDataUrl), {
        waitUntil: "load",
      });
      const fontLoaded = await page.evaluate(async () => {
        await document.fonts.ready;
        const faces = [...document.fonts].filter(
          (fontFace) => fontFace.family === "Noto Sans JP",
        );
        return (
          faces.length > 0 &&
          faces.every((fontFace) => fontFace.status === "loaded")
        );
      });
      if (!fontLoaded) {
        throw new Error(
          `Noto Sans JPを読み込めませんでした: ${this.#fontPath}`,
        );
      }

      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
      });
      const pdfDocument = await PDFDocument.load(pdf);
      const pageCount = pdfDocument.getPageCount();
      if (pageCount !== 1) {
        throw new Error(
          `請求書PDFは1ページである必要がありますが、${pageCount}ページ生成されました。`,
        );
      }
      return new Uint8Array(pdf);
    } finally {
      await browser.close();
    }
  }
}
