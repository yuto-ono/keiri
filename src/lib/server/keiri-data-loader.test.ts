import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { BusinessPartner, Invoice, Issuer } from "../domain/model";
import {
  serializeBusinessPartner,
  serializeInvoice,
  serializeIssuer,
} from "../persistence/yaml-serializer";
import { KeiriDataLoadError, loadKeiriData } from "./keiri-data-loader";

const templateRoot = resolve(process.cwd(), "templates/keiri-data");

const issuer: Issuer = {
  revision: 1,
  id: "sole-proprietor",
  name: "山田太郎",
  registrationNumber: "T0000000000000",
  phone: "00-0000-0000",
  email: null,
  bankAccounts: [
    {
      id: "primary",
      bankName: "サンプル銀行",
      branchName: "本店",
      branchCode: "001",
      accountType: "ordinary",
      accountNumber: "1234567",
      accountHolderName: "ヤマダタロウ",
    },
  ],
  defaultBankAccountId: "primary",
};

const partner: BusinessPartner = {
  revision: 1,
  code: "ACME",
  addressee: "株式会社サンプル",
  honorific: "御中",
  requiresMonthlyInvoice: true,
  billingInstructions: null,
  unitPricesIncludeTax: false,
  issuerDisplay: {
    phone: true,
    email: false,
    bankAccountIds: ["primary"],
  },
  pdfFileNamePattern: "{businessPartnerCode}-{issueDate:YYYYMM}-{sequence}",
};

const invoice: Invoice = {
  revision: 1,
  status: "draft",
  invoiceNumber: "ACME-202610-01",
  businessPartner: {
    code: "ACME",
    snapshot: { addressee: "株式会社サンプル", honorific: "御中" },
  },
  issuer: {
    id: "sole-proprietor",
    snapshot: {
      name: "山田太郎",
      registrationNumber: "T0000000000000",
      phone: { visible: true, value: "00-0000-0000" },
      email: { visible: false },
      bankAccounts: issuer.bankAccounts,
    },
  },
  issueDate: "2026-10-01",
  transactionDate: "2026-10-01",
  paymentDueDate: "2026-11-30",
  paymentCompletedDate: null,
  unitPricesIncludeTax: false,
  lineItems: [],
  notes: null,
  rounding: { lineAmount: "floor", taxAmount: "floor" },
  pdf: { fileNameOverride: null, issuedFileName: null },
};

let temporaryRoot: string;
let dataRoot: string;

beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "keiri-data-loader-"));
  dataRoot = join(temporaryRoot, "keiri-data");
  await cp(templateRoot, dataRoot, { recursive: true });
  await unlink(join(dataRoot, "issuers/your-issuer-id.yaml"));
  await Promise.all([
    writeFile(
      join(dataRoot, "issuers/sole-proprietor.yaml"),
      serializeIssuer(issuer),
    ),
    writeFile(
      join(dataRoot, "business-partners/ACME.yaml"),
      serializeBusinessPartner(partner),
    ),
    mkdir(join(dataRoot, "sales/invoices/2026"), { recursive: true }),
  ]);
  await writeFile(
    join(dataRoot, "sales/invoices/2026/ACME-202610-01.yaml"),
    serializeInvoice(invoice),
  );
});

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe("keiri-dataの一括読み込み", () => {
  it("必須ファイルを解析し、参照整合性を検証して返す", async () => {
    const loaded = await loadKeiriData(dataRoot);
    expect(loaded.settings.data.rounding.lineAmount).toBe("floor");
    expect(loaded.taxCategories.data.taxCategories).toHaveLength(1);
    expect(loaded.businessPartners[0].data.code).toBe("ACME");
    expect(loaded.invoices[0].data.invoiceNumber).toBe("ACME-202610-01");
  });

  it("複数ファイルの問題をまとめて返す", async () => {
    await Promise.all([
      writeFile(
        join(dataRoot, "settings.yaml"),
        "revision: 1\nunknown: true\n",
      ),
      writeFile(
        join(dataRoot, "business-partners/ACME.yaml"),
        "revision: invalid\n",
      ),
    ]);

    await expect(loadKeiriData(dataRoot)).rejects.toMatchObject({
      name: "KeiriDataLoadError",
      issues: expect.arrayContaining([
        expect.objectContaining({ filePath: "settings.yaml" }),
        expect.objectContaining({
          filePath: "business-partners/ACME.yaml",
        }),
      ]),
    });
  });

  it("発行済み請求書が参照する正式PDFの存在を検証する", async () => {
    const issuedInvoice: Invoice = {
      ...invoice,
      status: "issued",
      lineItems: [
        {
          name: "業務",
          quantity: 1,
          unit: "式",
          unitPrice: 10_000,
          taxCategoryId: "standard-10",
        },
      ],
      pdf: { fileNameOverride: null, issuedFileName: "ACME-202610-01.pdf" },
    };
    await writeFile(
      join(dataRoot, "sales/invoices/2026/ACME-202610-01.yaml"),
      serializeInvoice(issuedInvoice),
    );

    await expect(loadKeiriData(dataRoot)).rejects.toBeInstanceOf(
      KeiriDataLoadError,
    );

    const pdfDirectory = join(dataRoot, "documents/2026/sales/invoices/ACME");
    await mkdir(pdfDirectory, { recursive: true });
    await writeFile(join(pdfDirectory, "ACME-202610-01.pdf"), "test PDF");

    await expect(loadKeiriData(dataRoot)).resolves.toMatchObject({
      invoices: [
        { data: { status: "issued", invoiceNumber: "ACME-202610-01" } },
      ],
    });
  });
});
