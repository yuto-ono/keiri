import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getInvoice,
  getInvoicePdf,
  listInvoices,
} from "#lib/application/read-keiri-data";
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
import { FileKeiriReadGateway } from "./file-keiri-read-gateway";

let dataRoot: string;
const fileName = "日本語の請求書 '特別'(1).pdf";
const issued = {
  ...createInvoiceForPartner(createPartner(), "issued"),
  invoiceNumber: "ACME-202512-02",
  invoiceDate: "2025-12-31",
  pdf: { fileNameOverride: null, issuedFileName: fileName },
};
const pdfPath = `documents/2025/sales/invoices/ACME/${fileName}`;
const originalPdf = new Uint8Array([0, 255, 37, 42]);

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), "keiri-read-"));
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
  await mkdir(join(dataRoot, "sales/invoices/2026"), { recursive: true });
  await mkdir(join(dataRoot, "sales/invoices/2025"), { recursive: true });
  await mkdir(join(dataRoot, "documents/2025/sales/invoices/ACME"), {
    recursive: true,
  });
  await writeFile(
    join(dataRoot, "sales/invoices/2026/ACME-202610-01.yaml"),
    `# 読み取りでは書式を変えない\n${serializeInvoice(createInvoiceForPartner())}`,
  );
  await writeFile(
    join(dataRoot, "sales/invoices/2025/ACME-202512-02.yaml"),
    serializeInvoice(issued),
  );
  await writeFile(join(dataRoot, pdfPath), originalPdf);
  await writeFile(
    join(dataRoot, "documents/2025/sales/invoices/ACME/管理外.pdf"),
    "利用者が管理する書類",
  );
});
afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true });
});

describe("ファイルシステムを使う読み取り", () => {
  it("検証済みのデータを取得し、YAMLの内容・コメントやPDFを変更しない", async () => {
    const paths = [
      "settings.yaml",
      "tax-categories.yaml",
      "issuers/issuer.yaml",
      "business-partners/ACME.yaml",
      "sales/invoices/2026/ACME-202610-01.yaml",
      "sales/invoices/2025/ACME-202512-02.yaml",
      pdfPath,
      "documents/2025/sales/invoices/ACME/管理外.pdf",
    ];
    const before = await Promise.all(
      paths.map((path) => readFile(join(dataRoot, path))),
    );
    const gateway = new FileKeiriReadGateway(dataRoot);
    const result = await listInvoices(gateway, {
      today: "2026-10-25",
      year: "2025",
    });
    expect(result.months).toMatchObject([
      { month: "2025-12", invoices: [{ invoiceNumber: issued.invoiceNumber }] },
    ]);
    const detail = await getInvoice(gateway, issued.invoiceNumber);
    expect(detail?.invoice).toEqual(issued);
    expect((await gateway.loadData()).settings.revision).toBe(1);
    for (const [index, path] of paths.entries()) {
      expect(await readFile(join(dataRoot, path))).toEqual(before[index]);
    }
  });

  it("請求年と記録済みファイル名でPDFを読み、内容の再検査や管理外PDFの配信をしない", async () => {
    const gateway = new FileKeiriReadGateway(dataRoot);
    expect(await getInvoicePdf(gateway, issued.invoiceNumber)).toEqual({
      fileName,
      contents: originalPdf,
    });
    expect(await getInvoicePdf(gateway, "管理外.pdf")).toBeUndefined();
    expect(await getInvoicePdf(gateway, "../../管理外.pdf")).toBeUndefined();
    await expect(
      gateway.readIssuedPdf(createInvoiceForPartner()),
    ).rejects.toThrow("発行済み請求書の正式PDFだけ");
  });

  it("不正な必須YAMLは対象パス付きで読み込みを拒否し、自動修復しない", async () => {
    const invalid = "revision: 1\nrounding: broken\n";
    await writeFile(join(dataRoot, "settings.yaml"), invalid);
    await expect(
      new FileKeiriReadGateway(dataRoot).loadData(),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ filePath: "settings.yaml" })],
    });
    expect(await readFile(join(dataRoot, "settings.yaml"), "utf8")).toBe(
      invalid,
    );
  });

  it("記録された正式PDFが不足している場合は通常のデータ取得も拒否する", async () => {
    await unlink(join(dataRoot, pdfPath));
    await expect(
      new FileKeiriReadGateway(dataRoot).loadData(),
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          filePath: "sales/invoices/2025/ACME-202512-02.yaml",
          path: ["pdf", "issuedFileName"],
        }),
      ],
    });
  });
});
