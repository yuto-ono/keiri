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
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBusinessPartner,
  updateBusinessPartner,
} from "#lib/application/manage-business-partners";
import { createInvoiceDraft } from "#lib/application/create-invoice-draft";
import { updateIssuer } from "#lib/application/update-issuer";
import { issuerSchema } from "#lib/persistence/schemas";
import { parseYaml } from "#lib/persistence/yaml-parser";
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
import { FileBusinessPartnerGateway } from "./file-business-partner-gateway";
import { FileInvoiceCreationGateway } from "./file-invoice-creation-gateway";
import { FileIssuerUpdateGateway } from "./file-issuer-update-gateway";
import { loadKeiriData } from "./keiri-data-loader";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
const actualFs =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let dataRoot: string;

beforeEach(async () => {
  vi.mocked(rename).mockReset().mockImplementation(actualFs.rename);
  dataRoot = await mkdtemp(join(tmpdir(), "keiri-issuer-"));
  await cp(resolve("templates/keiri-data"), dataRoot, { recursive: true });
  await unlink(join(dataRoot, "issuers/your-issuer-id.yaml"));
  await writeFile(
    join(dataRoot, "issuers/issuer.yaml"),
    serializeIssuer(createIssuer()),
  );
  await writeFile(
    join(dataRoot, "business-partners/ACME.yaml"),
    serializeBusinessPartner(
      createPartner({
        issuerDisplay: {
          phone: true,
          email: false,
          bankAccountIds: ["primary"],
        },
      }),
    ),
  );
});
afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true });
});

async function saveInvoiceFixtures() {
  const invoiceDirectory = join(dataRoot, "sales/invoices/2026");
  const pdfDirectory = join(dataRoot, "documents/2026/sales/invoices/ACME");
  await mkdir(invoiceDirectory, { recursive: true });
  await mkdir(pdfDirectory, { recursive: true });
  const invoices = [
    createInvoiceForPartner(),
    {
      ...createInvoiceForPartner(createPartner(), "issued"),
      invoiceNumber: "ACME-202610-02",
      pdf: { fileNameOverride: null, issuedFileName: "請求書.pdf" },
    },
  ];
  for (const invoice of invoices) {
    invoice.issuer.snapshot.phone = {
      visible: true,
      value: createIssuer().phone!,
    };
    await writeFile(
      join(invoiceDirectory, `${invoice.invoiceNumber}.yaml`),
      serializeInvoice(invoice),
    );
  }
  await writeFile(join(pdfDirectory, "請求書.pdf"), "正式PDFのバイト列");
  return invoices;
}

describe("ファイルシステムを使う発行者更新", () => {
  it("発行者と口座を同じファイルへ保存し、取引先・既存請求書・PDFを変更しない", async () => {
    const invoices = await saveInvoiceFixtures();
    const oldInvoiceSources = await Promise.all(
      invoices.map((invoice) =>
        readFile(
          join(dataRoot, `sales/invoices/2026/${invoice.invoiceNumber}.yaml`),
          "utf8",
        ),
      ),
    );
    const partnerSource = await readFile(
      join(dataRoot, "business-partners/ACME.yaml"),
      "utf8",
    );
    const proposed = {
      ...createIssuer(),
      name: "新しい発行者名",
      phone: "090-1234-5678",
      email: "連絡先",
      defaultBankAccountId: "secondary",
      bankAccounts: createIssuer().bankAccounts.map((account) => ({
        ...account,
        bankName: "変更後の銀行",
        branchCode: "007",
        accountNumber: "0001234",
      })),
    };
    const result = await updateIssuer(
      new FileIssuerUpdateGateway(dataRoot),
      "issuer",
      proposed,
    );
    expect(result.filePath).toBe("issuers/issuer.yaml");
    expect(result.issuer.revision).toBe(2);
    const source = await readFile(join(dataRoot, result.filePath), "utf8");
    expect(parseYaml(source, result.filePath, issuerSchema)).toEqual(
      result.issuer,
    );
    expect(await readdir(join(dataRoot, "issuers"))).toEqual(["issuer.yaml"]);
    expect(
      await readFile(join(dataRoot, "business-partners/ACME.yaml"), "utf8"),
    ).toBe(partnerSource);
    for (const [index, invoice] of invoices.entries()) {
      expect(
        await readFile(
          join(dataRoot, `sales/invoices/2026/${invoice.invoiceNumber}.yaml`),
          "utf8",
        ),
      ).toBe(oldInvoiceSources[index]);
    }
    expect(
      await readFile(
        join(dataRoot, "documents/2026/sales/invoices/ACME/請求書.pdf"),
        "utf8",
      ),
    ).toBe("正式PDFのバイト列");

    const next = await createInvoiceDraft(
      new FileInvoiceCreationGateway(dataRoot),
      {
        businessPartnerCode: "ACME",
        paymentDueDate: "2026-11-30",
        today: "2026-10-25",
      },
    );
    expect(next.invoice.issuer.snapshot.name).toBe("新しい発行者名");
    expect(next.invoice.issuer.snapshot.phone).toEqual({
      visible: true,
      value: "090-1234-5678",
    });
    expect(next.invoice.issuer.snapshot.bankAccounts).toEqual([
      result.issuer.bankAccounts[0],
    ]);
    const newPartner = await createBusinessPartner(
      new FileBusinessPartnerGateway(dataRoot),
      {
        code: "NEW",
        addressee: "新規取引先",
        honorific: "様",
        requiresMonthlyInvoice: false,
        unitPricesIncludeTax: false,
      },
    );
    expect(newPartner.businessPartner.issuerDisplay.bankAccountIds).toEqual([
      "secondary",
    ]);
    await expect(loadKeiriData(dataRoot)).resolves.toBeDefined();
  });

  it("取引先の参照を解除してから連絡先・口座を削除でき、過去のスナップショットは残る", async () => {
    const invoices = await saveInvoiceFixtures();
    const gateway = new FileIssuerUpdateGateway(dataRoot);
    const switched = await updateIssuer(gateway, "issuer", {
      ...createIssuer(),
      defaultBankAccountId: "secondary",
    });
    const source = await readFile(join(dataRoot, switched.filePath), "utf8");
    const proposed = {
      ...switched.issuer,
      phone: null,
      bankAccounts: [switched.issuer.bankAccounts[1]],
    };
    await expect(updateIssuer(gateway, "issuer", proposed)).rejects.toThrow(
      "発行者を更新できません",
    );
    expect(await readFile(join(dataRoot, switched.filePath), "utf8")).toBe(
      source,
    );
    await updateBusinessPartner(
      new FileBusinessPartnerGateway(dataRoot),
      "ACME",
      createPartner({
        issuerDisplay: {
          phone: false,
          email: false,
          bankAccountIds: ["secondary"],
        },
      }),
    );
    const result = await updateIssuer(gateway, "issuer", proposed);
    expect(result.issuer).toMatchObject({
      revision: 3,
      phone: null,
      defaultBankAccountId: "secondary",
    });
    const data = await loadKeiriData(dataRoot);
    expect(data.invoices.map((record) => record.data)).toEqual(invoices);
    expect(
      await readFile(
        join(dataRoot, "documents/2026/sales/invoices/ACME/請求書.pdf"),
        "utf8",
      ),
    ).toBe("正式PDFのバイト列");
  });

  it("保存失敗時は元のYAMLを維持し、一時ファイルを残さない", async () => {
    const original = await readFile(
      join(dataRoot, "issuers/issuer.yaml"),
      "utf8",
    );
    const partnerSource = await readFile(
      join(dataRoot, "business-partners/ACME.yaml"),
      "utf8",
    );
    const failure = new Error("保存できません。");
    vi.mocked(rename).mockRejectedValueOnce(failure);
    await expect(
      updateIssuer(new FileIssuerUpdateGateway(dataRoot), "issuer", {
        ...createIssuer(),
        name: "変更後",
      }),
    ).rejects.toBe(failure);
    expect(await readFile(join(dataRoot, "issuers/issuer.yaml"), "utf8")).toBe(
      original,
    );
    expect(
      await readFile(join(dataRoot, "business-partners/ACME.yaml"), "utf8"),
    ).toBe(partnerSource);
    expect(await readdir(join(dataRoot, "issuers"))).toEqual(["issuer.yaml"]);
  });
});
