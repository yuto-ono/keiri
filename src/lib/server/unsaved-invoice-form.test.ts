import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInvoiceDraft } from "#lib/application/create-invoice-draft";
import { getInvoiceCreationData } from "#lib/application/read-keiri-data";
import {
  serializeBusinessPartner,
  serializeIssuer,
} from "#lib/persistence/yaml-serializer";
import { createIssuer, createPartner } from "#lib/testing/business-partners";
import { createInvoiceDraftFormContent } from "#lib/testing/invoice-draft-form";
import {
  changeUnsavedInvoicePartner,
  createUnsavedInvoiceForm,
  saveUnsavedInvoice,
} from "#lib/ui/invoice-creation";
import { FileInvoiceCreationGateway } from "./file-invoice-creation-gateway";
import { FileKeiriReadGateway } from "./file-keiri-read-gateway";
import {
  handleCreateInvoiceRequest,
  handleDuplicateInvoiceRequest,
} from "./invoice-api";
import { loadKeiriData } from "./keiri-data-loader";

let dataRoot: string;
beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), "keiri-unsaved-form-"));
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
});
afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true });
});

describe("未保存フォームからの初回保存", () => {
  it("準備と入力だけでは採番・保存せず、保存時に明細付きのリビジョン1を作る", async () => {
    const gateway = new FileKeiriReadGateway(dataRoot);
    const context = {
      ...(await getInvoiceCreationData(gateway))!,
      today: "2026-10-26",
    };
    let form = createUnsavedInvoiceForm(context);
    form = changeUnsavedInvoicePartner(form, "ACME", context);
    form.invoiceDate = "2026-12-01";
    form.paymentDueDate = "2026-12-31";
    form.lineItems.push({
      name: "入力した業務",
      quantity: 2.5,
      unit: "時間",
      unitPrice: 10000,
    });
    form.notes = "初回保存の備考";
    expect(await readdir(join(dataRoot, "sales/invoices"))).toEqual([
      ".gitkeep",
    ]);
    const fetcher: typeof fetch = async (url, init) => {
      const request = new Request(`http://127.0.0.1${url}`, {
        ...init,
        headers: { ...init?.headers, origin: "http://127.0.0.1" },
      });
      return handleCreateInvoiceRequest(request, new URL(request.url), {
        gateway: new FileInvoiceCreationGateway(dataRoot),
        today: context.today,
      });
    };
    const result = await saveUnsavedInvoice(fetcher, form, context);
    expect(result).toMatchObject({
      ok: true,
      value: {
        invoice: {
          invoiceNumber: "ACME-202612-01",
          revision: 1,
          notes: "初回保存の備考",
          lineItems: [{ name: "入力した業務" }],
        },
      },
    });
    expect(await readdir(join(dataRoot, "sales/invoices"))).toEqual([
      ".gitkeep",
      "2026",
    ]);
    expect((await loadKeiriData(dataRoot)).invoices).toHaveLength(1);
  });
  it("複製準備でファイルを増やさず、編集後の保存でも複製元のYAMLを維持する", async () => {
    const source = await createInvoiceDraft(
      new FileInvoiceCreationGateway(dataRoot),
      {
        businessPartnerCode: "ACME",
        invoiceDate: "2026-10-01",
        paymentDueDate: "2026-10-31",
        today: "2026-10-26",
        content: createInvoiceDraftFormContent({
          notes: "元の備考",
          pdfFileNameOverride: "元の個別名",
        }),
      },
    );
    const before = await readFile(join(dataRoot, source.filePath), "utf8");
    const context = {
      ...(await getInvoiceCreationData(
        new FileKeiriReadGateway(dataRoot),
        source.invoice.invoiceNumber,
      ))!,
      today: "2026-10-26",
    };
    const form = createUnsavedInvoiceForm(context);
    form.paymentDueDate = "2026-11-30";
    form.notes = "複製後の備考";
    expect(await readdir(join(dataRoot, "sales/invoices/2026"))).toEqual([
      "ACME-202610-01.yaml",
    ]);
    const fetcher: typeof fetch = async (url, init) => {
      const request = new Request(`http://127.0.0.1${url}`, {
        ...init,
        headers: { ...init?.headers, origin: "http://127.0.0.1" },
      });
      return handleDuplicateInvoiceRequest(
        request,
        new URL(request.url),
        source.invoice.invoiceNumber,
        {
          gateway: new FileInvoiceCreationGateway(dataRoot),
          today: context.today,
        },
      );
    };
    const result = await saveUnsavedInvoice(fetcher, form, context);
    expect(result).toMatchObject({
      ok: true,
      value: {
        invoice: {
          invoiceNumber: "ACME-202610-02",
          revision: 1,
          invoiceDate: context.today,
          notes: "複製後の備考",
          pdf: { fileNameOverride: null, issuedFileName: null },
        },
      },
    });
    expect(await readFile(join(dataRoot, source.filePath), "utf8")).toBe(
      before,
    );
    expect((await loadKeiriData(dataRoot)).invoices).toHaveLength(2);
  });
});
