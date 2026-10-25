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
  deleteBusinessPartner,
  updateBusinessPartner,
} from "#lib/application/manage-business-partners";
import { createInvoiceDraft } from "#lib/application/create-invoice-draft";
import { businessPartnerSchema } from "#lib/persistence/schemas";
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
import { loadKeiriData } from "./keiri-data-loader";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(actual.rename),
    unlink: vi.fn(actual.unlink),
  };
});
const actualFs =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let dataRoot: string;

beforeEach(async () => {
  vi.mocked(rename).mockReset().mockImplementation(actualFs.rename);
  vi.mocked(unlink).mockReset().mockImplementation(actualFs.unlink);
  dataRoot = await mkdtemp(join(tmpdir(), "keiri-partners-"));
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

describe("ファイルシステムを使う取引先管理", () => {
  it("新規登録・更新・削除したYAMLを再読み込みできる", async () => {
    const gateway = new FileBusinessPartnerGateway(dataRoot);
    const created = await createBusinessPartner(gateway, {
      code: "NewCo",
      addressee: "新規",
      honorific: "様",
      requiresMonthlyInvoice: false,
      unitPricesIncludeTax: true,
    });
    expect(created.filePath).toBe("business-partners/NewCo.yaml");
    const updated = await updateBusinessPartner(gateway, "NewCo", {
      ...created.businessPartner,
      billingInstructions: "請求内容を確認する\n\n支払期限を確認する",
    });
    expect(updated.businessPartner.revision).toBe(2);
    const source = await readFile(join(dataRoot, updated.filePath), "utf8");
    expect(parseYaml(source, updated.filePath, businessPartnerSchema)).toEqual(
      updated.businessPartner,
    );
    await deleteBusinessPartner(gateway, {
      code: "NewCo",
      expectedRevision: 2,
    });
    expect(
      (await loadKeiriData(dataRoot)).businessPartners.map(
        (record) => record.data.code,
      ),
    ).toEqual(["ACME"]);
  });

  it.each(["NEW", "acme"])(
    "未参照のコードを %s へ変更し、ファイル名も表記に合わせる",
    async (code) => {
      const result = await updateBusinessPartner(
        new FileBusinessPartnerGateway(dataRoot),
        "ACME",
        createPartner({ code }),
      );
      expect(
        (await readdir(join(dataRoot, "business-partners"))).filter((name) =>
          name.endsWith(".yaml"),
        ),
      ).toEqual([`${code}.yaml`]);
      expect((await loadKeiriData(dataRoot)).businessPartners[0].data).toEqual(
        result.businessPartner,
      );
    },
  );

  it("下書き・発行済み請求書のスナップショットとPDFを維持し、新しい下書きへ変更を反映する", async () => {
    const invoiceDirectory = join(dataRoot, "sales/invoices/2026");
    const pdfDirectory = join(dataRoot, "documents/2026/sales/invoices/ACME");
    await mkdir(invoiceDirectory, { recursive: true });
    await mkdir(pdfDirectory, { recursive: true });
    const originals = [
      createInvoiceForPartner(),
      {
        ...createInvoiceForPartner(createPartner(), "issued"),
        invoiceNumber: "ACME-202610-02",
        pdf: { fileNameOverride: null, issuedFileName: "発行済み.pdf" },
      },
    ];
    for (const invoice of originals) {
      await writeFile(
        join(invoiceDirectory, `${invoice.invoiceNumber}.yaml`),
        serializeInvoice(invoice),
      );
    }
    await writeFile(join(pdfDirectory, "発行済み.pdf"), "正式PDFのバイト列");
    const before = await Promise.all(
      originals.map((invoice) =>
        readFile(
          join(invoiceDirectory, `${invoice.invoiceNumber}.yaml`),
          "utf8",
        ),
      ),
    );
    const gateway = new FileBusinessPartnerGateway(dataRoot);
    await updateBusinessPartner(
      gateway,
      "ACME",
      createPartner({
        addressee: "新しい宛名",
        honorific: "様",
        unitPricesIncludeTax: true,
        issuerDisplay: {
          phone: true,
          email: false,
          bankAccountIds: ["secondary"],
        },
      }),
    );
    for (const [index, invoice] of originals.entries()) {
      expect(
        await readFile(
          join(invoiceDirectory, `${invoice.invoiceNumber}.yaml`),
          "utf8",
        ),
      ).toBe(before[index]);
    }
    expect(await readFile(join(pdfDirectory, "発行済み.pdf"), "utf8")).toBe(
      "正式PDFのバイト列",
    );
    await expect(
      deleteBusinessPartner(gateway, { code: "ACME", expectedRevision: 2 }),
    ).rejects.toThrow("取引先を変更できません");
    await expect(
      updateBusinessPartner(
        gateway,
        "ACME",
        createPartner({ code: "RENAMED", revision: 2 }),
      ),
    ).rejects.toThrow("取引先を変更できません");
    const next = await createInvoiceDraft(
      new FileInvoiceCreationGateway(dataRoot),
      {
        businessPartnerCode: "ACME",
        paymentDueDate: "2026-11-30",
        today: "2026-10-25",
      },
    );
    expect(next.invoice.businessPartner.snapshot).toEqual({
      addressee: "新しい宛名",
      honorific: "様",
    });
    expect(next.invoice.unitPricesIncludeTax).toBe(true);
    expect(
      next.invoice.issuer.snapshot.bankAccounts.map((account) => account.id),
    ).toEqual(["secondary"]);
  });

  it("名前変更で旧ファイルの削除に失敗した場合は元を維持し、新しいファイルを残さない", async () => {
    const original = await readFile(
      join(dataRoot, "business-partners/ACME.yaml"),
      "utf8",
    );
    const error = new Error("旧ファイルを削除できません。");
    vi.mocked(unlink).mockRejectedValueOnce(error);
    await expect(
      updateBusinessPartner(
        new FileBusinessPartnerGateway(dataRoot),
        "ACME",
        createPartner({ code: "NEW" }),
      ),
    ).rejects.toBe(error);
    expect(
      await readFile(join(dataRoot, "business-partners/ACME.yaml"), "utf8"),
    ).toBe(original);
    expect(
      (await readdir(join(dataRoot, "business-partners"))).filter(
        (name) => name !== ".gitkeep",
      ),
    ).toEqual(["ACME.yaml"]);
  });

  it("大文字・小文字だけの名前変更中に保存が失敗しても元の名前と内容を復元する", async () => {
    const original = await readFile(
      join(dataRoot, "business-partners/ACME.yaml"),
      "utf8",
    );
    const error = new Error("新しい内容を反映できません。");
    vi.mocked(rename).mockImplementation(async (source, target) => {
      if (String(source).endsWith(".tmp")) {
        throw error;
      }
      return actualFs.rename(source, target);
    });
    await expect(
      updateBusinessPartner(
        new FileBusinessPartnerGateway(dataRoot),
        "ACME",
        createPartner({ code: "acme" }),
      ),
    ).rejects.toBe(error);
    expect(
      await readFile(join(dataRoot, "business-partners/ACME.yaml"), "utf8"),
    ).toBe(original);
    expect(
      (await readdir(join(dataRoot, "business-partners"))).filter(
        (name) => name !== ".gitkeep",
      ),
    ).toEqual(["ACME.yaml"]);
  });

  it("削除失敗とリビジョン不一致では元のYAMLを維持する", async () => {
    const original = await readFile(
      join(dataRoot, "business-partners/ACME.yaml"),
      "utf8",
    );
    const gateway = new FileBusinessPartnerGateway(dataRoot);
    await expect(
      deleteBusinessPartner(gateway, { code: "ACME", expectedRevision: 2 }),
    ).rejects.toThrow("取引先を変更できません");
    const error = new Error("削除できません。");
    vi.mocked(unlink).mockRejectedValueOnce(error);
    await expect(
      deleteBusinessPartner(gateway, { code: "ACME", expectedRevision: 1 }),
    ).rejects.toBe(error);
    expect(
      await readFile(join(dataRoot, "business-partners/ACME.yaml"), "utf8"),
    ).toBe(original);
  });
});
