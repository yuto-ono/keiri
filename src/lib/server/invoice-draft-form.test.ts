import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInvoiceDraft } from "#lib/application/create-invoice-draft";
import { duplicateInvoiceDraft } from "#lib/application/duplicate-invoice-draft";
import {
  serializeBusinessPartner,
  serializeIssuer,
} from "#lib/persistence/yaml-serializer";
import { createIssuer, createPartner } from "#lib/testing/business-partners";
import { createInvoiceDraftFormContent } from "#lib/testing/invoice-draft-form";
import { FileInvoiceCreationGateway } from "./file-invoice-creation-gateway";
import { handleCreateInvoiceRequest } from "./invoice-api";
import { loadKeiriData } from "./keiri-data-loader";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const actualFileSystem =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let dataRoot: string;

beforeEach(async () => {
  vi.mocked(rename).mockReset().mockImplementation(actualFileSystem.rename);
  dataRoot = await mkdtemp(join(tmpdir(), "keiri-draft-form-"));
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

const input = {
  businessPartnerCode: "ACME",
  invoiceDate: "2026-10-25",
  paymentDueDate: "2026-11-30",
  today: "2026-10-26",
};

describe("全体フォームのファイル保存", () => {
  it("APIの初回保存で入力全体を請求年へ保存し、中間の空下書きを作らない", async () => {
    const content = createInvoiceDraftFormContent({
      honorific: "様",
      bankAccountIds: ["secondary", "primary"],
      notes: "初回保存の備考",
      pdfFileNameOverride: "初回保存の個別名",
    });
    const request = new Request("http://127.0.0.1:5173/api/invoices", {
      method: "POST",
      headers: {
        origin: "http://127.0.0.1:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        businessPartnerCode: input.businessPartnerCode,
        invoiceDate: input.invoiceDate,
        paymentDueDate: input.paymentDueDate,
        content,
      }),
    });
    const response = await handleCreateInvoiceRequest(
      request,
      new URL(request.url),
      { gateway: new FileInvoiceCreationGateway(dataRoot), today: input.today },
    );
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.filePath).toBe("sales/invoices/2026/ACME-202610-01.yaml");
    expect(result.invoice.revision).toBe(1);
    expect(result.invoice.lineItems).toEqual(content.lineItems);
    expect(result.invoice.notes).toBe(content.notes);
    expect(
      (await loadKeiriData(dataRoot)).invoices.map((record) => record.data),
    ).toEqual([result.invoice]);
    expect(await readdir(join(dataRoot, "sales/invoices"))).toEqual([
      ".gitkeep",
      "2026",
    ]);
    expect(await readdir(join(dataRoot, "sales/invoices/2026"))).toEqual([
      "ACME-202610-01.yaml",
    ]);
    expect(rename).toHaveBeenCalledOnce();
  });

  it("検証失敗ではファイルを作らず、修正後の保存で最初の番号を使う", async () => {
    const gateway = new FileInvoiceCreationGateway(dataRoot);
    const invalid = createInvoiceDraftFormContent({
      pdfFileNameOverride: "不正/個別名",
    });
    await expect(
      createInvoiceDraft(gateway, { ...input, content: invalid }),
    ).rejects.toThrow("作成内容が不正");
    expect(await readdir(join(dataRoot, "sales/invoices"))).toEqual([
      ".gitkeep",
    ]);
    expect(rename).not.toHaveBeenCalled();
    const result = await createInvoiceDraft(gateway, {
      ...input,
      content: createInvoiceDraftFormContent(),
    });
    expect(result.invoice.invoiceNumber).toBe("ACME-202610-01");
  });

  it("atomic renameの失敗で空下書きや一時ファイルを残さず、再保存できる", async () => {
    const gateway = new FileInvoiceCreationGateway(dataRoot);
    const failure = new Error("YAMLの反映に失敗しました。");
    vi.mocked(rename).mockRejectedValueOnce(failure);
    const content = createInvoiceDraftFormContent({
      notes: "失敗しても送信内容は変えない",
    });
    const before = structuredClone(content);
    await expect(
      createInvoiceDraft(gateway, { ...input, content }),
    ).rejects.toBe(failure);
    expect(await readdir(join(dataRoot, "sales/invoices/2026"))).toEqual([]);
    expect(content).toEqual(before);
    const result = await createInvoiceDraft(gateway, { ...input, content });
    expect(result.invoice.invoiceNumber).toBe("ACME-202610-01");
    expect(result.invoice.revision).toBe(1);
    expect(result.invoice.notes).toBe(content.notes);
    expect(await readdir(join(dataRoot, "sales/invoices/2026"))).toEqual([
      "ACME-202610-01.yaml",
    ]);
  });

  it("複製フォームの変更を新しい番号で保存し、複製元のYAMLを維持する", async () => {
    const gateway = new FileInvoiceCreationGateway(dataRoot);
    const source = await createInvoiceDraft(gateway, {
      ...input,
      content: createInvoiceDraftFormContent({
        notes: "複製元の備考",
        pdfFileNameOverride: "複製元の個別名",
      }),
    });
    const sourceYaml = await readFile(join(dataRoot, source.filePath), "utf8");
    const content = createInvoiceDraftFormContent({
      notes: null,
      lineItems: [
        { ...source.invoice.lineItems[0], name: "複製後の変更", quantity: 2 },
      ],
    });
    const duplicated = await duplicateInvoiceDraft(gateway, {
      ...input,
      sourceInvoiceNumber: source.invoice.invoiceNumber,
      content,
    });
    expect(duplicated.filePath).toBe("sales/invoices/2026/ACME-202610-02.yaml");
    expect(duplicated.invoice).toMatchObject({
      revision: 1,
      lineItems: content.lineItems,
      notes: null,
      pdf: { fileNameOverride: null, issuedFileName: null },
    });
    expect(await readFile(join(dataRoot, source.filePath), "utf8")).toBe(
      sourceYaml,
    );
    expect((await loadKeiriData(dataRoot)).invoices).toHaveLength(2);
    expect(rename).toHaveBeenCalledTimes(2);
  });
});
