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

import { createInvoiceDraft } from "#lib/application/create-invoice-draft";
import { duplicateInvoiceDraft } from "#lib/application/duplicate-invoice-draft";
import { updateSettings } from "#lib/application/update-settings";
import { settingsSchema } from "#lib/persistence/schemas";
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
import { FileInvoiceCreationGateway } from "./file-invoice-creation-gateway";
import { FileSettingsUpdateGateway } from "./file-settings-update-gateway";
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
  dataRoot = await mkdtemp(join(tmpdir(), "keiri-settings-"));
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

describe("ファイルシステムを使う端数処理設定の更新", () => {
  it("既存請求書と他の設定を維持し、新規作成・複製する下書きへ変更後の設定を取り込む", async () => {
    const invoices = [
      createInvoiceForPartner(),
      {
        ...createInvoiceForPartner(createPartner(), "issued"),
        invoiceNumber: "ACME-202610-02",
        pdf: { fileNameOverride: null, issuedFileName: "請求書.pdf" },
      },
    ];
    await mkdir(join(dataRoot, "sales/invoices/2026"), { recursive: true });
    await mkdir(join(dataRoot, "documents/2026/sales/invoices/ACME"), {
      recursive: true,
    });
    for (const invoice of invoices) {
      await writeFile(
        join(dataRoot, `sales/invoices/2026/${invoice.invoiceNumber}.yaml`),
        serializeInvoice(invoice),
      );
    }
    await writeFile(
      join(dataRoot, "documents/2026/sales/invoices/ACME/請求書.pdf"),
      "正式PDFのバイト列",
    );
    const protectedPaths = [
      "issuers/issuer.yaml",
      "business-partners/ACME.yaml",
      "tax-categories.yaml",
      ...invoices.map(
        (invoice) => `sales/invoices/2026/${invoice.invoiceNumber}.yaml`,
      ),
      "documents/2026/sales/invoices/ACME/請求書.pdf",
    ];
    const originals = await Promise.all(
      protectedPaths.map((path) => readFile(join(dataRoot, path))),
    );
    const rounding = { lineAmount: "ceil", taxAmount: "halfUp" } as const;
    const result = await updateSettings(
      new FileSettingsUpdateGateway(dataRoot),
      { revision: 1, rounding },
    );
    expect(result).toEqual({
      settings: { revision: 2, rounding },
      filePath: "settings.yaml",
    });
    const source = await readFile(join(dataRoot, "settings.yaml"), "utf8");
    expect(parseYaml(source, result.filePath, settingsSchema)).toEqual(
      result.settings,
    );
    for (const [index, path] of protectedPaths.entries()) {
      expect(await readFile(join(dataRoot, path))).toEqual(originals[index]);
    }

    const gateway = new FileInvoiceCreationGateway(dataRoot);
    const created = await createInvoiceDraft(gateway, {
      businessPartnerCode: "ACME",
      paymentDueDate: "2026-11-30",
      today: "2026-10-25",
    });
    const duplicated = await duplicateInvoiceDraft(gateway, {
      sourceInvoiceNumber: invoices[1].invoiceNumber,
      paymentDueDate: "2026-11-30",
      today: "2026-10-25",
    });
    expect(created.invoice.rounding).toEqual(rounding);
    expect(duplicated.invoice.rounding).toEqual(rounding);
    const data = await loadKeiriData(dataRoot);
    for (const invoice of invoices) {
      expect(
        data.invoices.find(
          (record) => record.data.invoiceNumber === invoice.invoiceNumber,
        )?.data,
      ).toEqual(invoice);
    }
  });

  it("一度更新した後は古いリビジョンの設定で上書きできない", async () => {
    const gateway = new FileSettingsUpdateGateway(dataRoot);
    const first = await updateSettings(gateway, {
      revision: 1,
      rounding: { lineAmount: "halfUp", taxAmount: "floor" },
    });
    const original = await readFile(join(dataRoot, "settings.yaml"), "utf8");
    await expect(
      updateSettings(gateway, {
        revision: 1,
        rounding: { lineAmount: "ceil", taxAmount: "ceil" },
      }),
    ).rejects.toThrow("端数処理設定を更新できません");
    expect(await readFile(join(dataRoot, "settings.yaml"), "utf8")).toBe(
      original,
    );
    expect((await loadKeiriData(dataRoot)).settings.data).toEqual(
      first.settings,
    );
  });

  it("保存に失敗した場合は元の設定を維持し、一時ファイルを残さない", async () => {
    const original = await readFile(join(dataRoot, "settings.yaml"), "utf8");
    const failure = new Error("設定を反映できません。");
    vi.mocked(rename).mockRejectedValueOnce(failure);
    await expect(
      updateSettings(new FileSettingsUpdateGateway(dataRoot), {
        revision: 1,
        rounding: { lineAmount: "halfUp", taxAmount: "ceil" },
      }),
    ).rejects.toBe(failure);
    expect(await readFile(join(dataRoot, "settings.yaml"), "utf8")).toBe(
      original,
    );
    expect(
      (await readdir(dataRoot)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("設定ファイルが不足している場合は更新を拒否し、自動作成しない", async () => {
    await unlink(join(dataRoot, "settings.yaml"));
    await expect(
      updateSettings(new FileSettingsUpdateGateway(dataRoot), {
        revision: 1,
        rounding: { lineAmount: "floor", taxAmount: "floor" },
      }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ filePath: "settings.yaml" })],
    });
    await expect(
      readFile(join(dataRoot, "settings.yaml")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
