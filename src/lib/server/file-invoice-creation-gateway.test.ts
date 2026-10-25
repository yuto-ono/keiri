import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createInvoiceDraft } from "../application/create-invoice-draft";
import { duplicateInvoiceDraft } from "../application/duplicate-invoice-draft";
import { updateInvoiceDraft } from "../application/update-invoice-draft";
import type { BusinessPartner, Issuer } from "../domain/model";
import { invoiceSchema } from "../persistence/schemas";
import { parseYaml } from "../persistence/yaml-parser";
import {
  serializeBusinessPartner,
  serializeIssuer,
} from "../persistence/yaml-serializer";
import { FileInvoiceCreationGateway } from "./file-invoice-creation-gateway";
import { FileInvoiceUpdateGateway } from "./file-invoice-update-gateway";

const issuer: Issuer = {
  revision: 1,
  id: "sole-proprietor",
  name: "山田太郎",
  registrationNumber: "T0000000000000",
  phone: null,
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
    phone: false,
    email: false,
    bankAccountIds: ["primary"],
  },
  pdfFileNamePattern: "{businessPartnerCode}-{issueDate:YYYYMM}-{sequence}",
};

let temporaryRoot: string;
let dataRoot: string;

beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "keiri-create-gateway-"));
  dataRoot = join(temporaryRoot, "keiri-data");
  await cp(resolve(process.cwd(), "templates/keiri-data"), dataRoot, {
    recursive: true,
  });
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
  ]);
});

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe("ファイルシステムを使う請求書作成gateway", () => {
  it("作成したYAMLを再読込し、次の作成では連番を進める", async () => {
    const gateway = new FileInvoiceCreationGateway(dataRoot);
    const first = await createInvoiceDraft(gateway, {
      businessPartnerCode: "ACME",
      paymentDueDate: "2026-11-30",
      today: "2026-10-25",
    });
    const second = await createInvoiceDraft(gateway, {
      businessPartnerCode: "ACME",
      paymentDueDate: "2026-11-30",
      today: "2026-10-25",
    });

    expect(first.invoice.invoiceNumber).toBe("ACME-202610-01");
    expect(second.invoice.invoiceNumber).toBe("ACME-202610-02");

    const source = await readFile(join(dataRoot, first.filePath), "utf8");
    expect(parseYaml(source, first.filePath, invoiceSchema)).toEqual(
      first.invoice,
    );
  });

  it("取引年を変更した更新では新しい年へYAMLを移動する", async () => {
    const created = await createInvoiceDraft(
      new FileInvoiceCreationGateway(dataRoot),
      {
        businessPartnerCode: "ACME",
        paymentDueDate: "2026-11-30",
        today: "2026-10-25",
      },
    );
    const updated = await updateInvoiceDraft(
      new FileInvoiceUpdateGateway(dataRoot),
      created.invoice.invoiceNumber,
      {
        ...created.invoice,
        transactionDate: "2025-12-31",
        notes: "更新後",
      },
    );

    expect(updated.filePath).toBe("sales/invoices/2025/ACME-202610-01.yaml");
    expect(updated.invoice.revision).toBe(2);
    await expect(
      readFile(join(dataRoot, created.filePath), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const source = await readFile(join(dataRoot, updated.filePath), "utf8");
    expect(parseYaml(source, updated.filePath, invoiceSchema)).toEqual(
      updated.invoice,
    );
  });

  it("保存済みYAMLを複製元として新しい下書きを保存する", async () => {
    const gateway = new FileInvoiceCreationGateway(dataRoot);
    const source = await createInvoiceDraft(gateway, {
      businessPartnerCode: "ACME",
      paymentDueDate: "2026-11-30",
      today: "2026-10-25",
    });
    const duplicated = await duplicateInvoiceDraft(gateway, {
      sourceInvoiceNumber: source.invoice.invoiceNumber,
      paymentDueDate: "2026-12-31",
      today: "2026-10-26",
    });

    expect(duplicated.invoice.invoiceNumber).toBe("ACME-202610-02");
    const sourceYaml = await readFile(join(dataRoot, source.filePath), "utf8");
    const duplicatedYaml = await readFile(
      join(dataRoot, duplicated.filePath),
      "utf8",
    );
    expect(parseYaml(sourceYaml, source.filePath, invoiceSchema)).toEqual(
      source.invoice,
    );
    expect(
      parseYaml(duplicatedYaml, duplicated.filePath, invoiceSchema),
    ).toEqual(duplicated.invoice);
  });
});
