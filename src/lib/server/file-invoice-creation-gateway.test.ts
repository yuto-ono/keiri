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

import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInvoiceDraft } from "../application/create-invoice-draft";
import { duplicateInvoiceDraft } from "../application/duplicate-invoice-draft";
import {
  issueInvoice,
  type InvoicePdfRenderer,
} from "../application/issue-invoice";
import { updateInvoiceDraft } from "../application/update-invoice-draft";
import { revertInvoiceToDraft } from "#lib/application/revert-invoice-to-draft";
import { deleteInvoiceDraft } from "#lib/application/delete-invoice-draft";
import {
  deleteInvoicePaymentCompletedDate,
  setInvoicePaymentCompletedDate,
} from "#lib/application/manage-invoice-payment";
import type { BusinessPartner, Issuer } from "../domain/model";
import { invoiceSchema } from "../persistence/schemas";
import { parseYaml } from "../persistence/yaml-parser";
import {
  serializeBusinessPartner,
  serializeIssuer,
  serializeInvoice,
} from "../persistence/yaml-serializer";
import { FileInvoiceCreationGateway } from "./file-invoice-creation-gateway";
import { FileInvoiceIssueGateway } from "./file-invoice-issue-gateway";
import { FileInvoiceUpdateGateway } from "./file-invoice-update-gateway";
import { FileInvoiceRevertToDraftGateway } from "./file-invoice-revert-to-draft-gateway";
import { FileInvoiceDeletionGateway } from "./file-invoice-deletion-gateway";
import { FileInvoicePaymentGateway } from "./file-invoice-payment-gateway";
import { loadKeiriData } from "./keiri-data-loader";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(actual.rename),
    unlink: vi.fn(actual.unlink),
  };
});

const actualFileSystem =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

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
  vi.mocked(rename).mockReset().mockImplementation(actualFileSystem.rename);
  vi.mocked(unlink).mockReset().mockImplementation(actualFileSystem.unlink);
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

  it("正式PDFと発行済みYAMLを保存する", async () => {
    const draft = await createPopulatedDraft();
    const pdfContents = await createPdf(1);
    const renderer: InvoicePdfRenderer = {
      async renderSinglePagePdf() {
        return pdfContents;
      },
    };

    const result = await issueInvoice(
      new FileInvoiceIssueGateway(dataRoot),
      renderer,
      {
        invoiceNumber: draft.invoice.invoiceNumber,
        expectedRevision: draft.invoice.revision,
        today: "2026-10-25",
      },
    );

    expect(result.invoice).toMatchObject({
      status: "issued",
      revision: 3,
      pdf: { issuedFileName: "ACME-202610-01.pdf" },
    });
    expect(result.invoiceFilePath).toBe(
      "sales/invoices/2026/ACME-202610-01.yaml",
    );
    expect(result.pdfFilePath).toBe(
      "documents/2026/sales/invoices/ACME/ACME-202610-01.pdf",
    );

    const invoiceSource = await readFile(
      join(dataRoot, result.invoiceFilePath),
      "utf8",
    );
    expect(
      parseYaml(invoiceSource, result.invoiceFilePath, invoiceSchema),
    ).toEqual(result.invoice);
    const savedPdf = await PDFDocument.load(
      await readFile(join(dataRoot, result.pdfFilePath)),
    );
    expect(savedPdf.getPageCount()).toBe(1);
  });

  it("PDF保存先が既にある場合は下書きを維持する", async () => {
    const draft = await createPopulatedDraft();
    const pdfFilePath = join(
      dataRoot,
      "documents/2026/sales/invoices/ACME/ACME-202610-01.pdf",
    );
    await mkdir(join(pdfFilePath, ".."), { recursive: true });
    await writeFile(pdfFilePath, "利用者が管理する既存PDF");
    const renderer: InvoicePdfRenderer = {
      async renderSinglePagePdf() {
        return createPdf(1);
      },
    };

    await expect(
      issueInvoice(new FileInvoiceIssueGateway(dataRoot), renderer, {
        invoiceNumber: draft.invoice.invoiceNumber,
        expectedRevision: draft.invoice.revision,
        today: "2026-10-25",
      }),
    ).rejects.toThrow("既に存在します");

    const invoiceSource = await readFile(
      join(dataRoot, draft.filePath),
      "utf8",
    );
    expect(parseYaml(invoiceSource, draft.filePath, invoiceSchema)).toEqual(
      draft.invoice,
    );
    expect(await readFile(pdfFilePath, "utf8")).toBe("利用者が管理する既存PDF");
  });

  it("2ページのPDFは保存せず下書きを維持する", async () => {
    const draft = await createPopulatedDraft();
    const renderer: InvoicePdfRenderer = {
      async renderSinglePagePdf() {
        return createPdf(2);
      },
    };

    await expect(
      issueInvoice(new FileInvoiceIssueGateway(dataRoot), renderer, {
        invoiceNumber: draft.invoice.invoiceNumber,
        expectedRevision: draft.invoice.revision,
        today: "2026-10-25",
      }),
    ).rejects.toThrow("2ページあります");

    const invoiceSource = await readFile(
      join(dataRoot, draft.filePath),
      "utf8",
    );
    expect(parseYaml(invoiceSource, draft.filePath, invoiceSchema)).toEqual(
      draft.invoice,
    );
    await expect(
      readFile(
        join(dataRoot, "documents/2026/sales/invoices/ACME/ACME-202610-01.pdf"),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function createPopulatedDraft() {
  const created = await createInvoiceDraft(
    new FileInvoiceCreationGateway(dataRoot),
    {
      businessPartnerCode: "ACME",
      paymentDueDate: "2026-11-30",
      today: "2026-10-25",
    },
  );
  return updateInvoiceDraft(
    new FileInvoiceUpdateGateway(dataRoot),
    created.invoice.invoiceNumber,
    {
      ...created.invoice,
      lineItems: [
        {
          name: "開発業務",
          quantity: 1,
          unit: "式",
          unitPrice: 10_000,
          taxCategoryId: "standard-10",
        },
      ],
    },
  );
}

describe("ファイルシステムを使う請求書下書きの削除", () => {
  it("取引年に保存されたYAMLだけを削除し、月次進捗と利用者管理のPDFは変更しない", async () => {
    const draft = await createPopulatedDraft();
    const moved = await updateInvoiceDraft(
      new FileInvoiceUpdateGateway(dataRoot),
      draft.invoice.invoiceNumber,
      { ...draft.invoice, transactionDate: "2025-12-31" },
    );
    const monthlyPath = join(dataRoot, "monthly-billing/2026-10.md");
    const pdfDirectory = join(dataRoot, "documents/2025/sales/invoices/ACME");
    const pdfPath = join(pdfDirectory, "利用者管理.pdf");
    await writeFile(monthlyPath, "月次業務の進捗は手動で管理する\n");
    await mkdir(pdfDirectory, { recursive: true });
    await writeFile(pdfPath, "利用者が管理するPDF");

    const result = await deleteInvoiceDraft(
      new FileInvoiceDeletionGateway(dataRoot),
      {
        invoiceNumber: moved.invoice.invoiceNumber,
        expectedRevision: moved.invoice.revision,
      },
    );

    expect(result).toEqual({
      invoiceNumber: moved.invoice.invoiceNumber,
      filePath: moved.filePath,
    });
    await expect(
      readFile(join(dataRoot, moved.filePath)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(join(dataRoot, "sales/invoices/2025"))).toEqual([]);
    expect(await readFile(monthlyPath, "utf8")).toBe(
      "月次業務の進捗は手動で管理する\n",
    );
    expect(await readFile(pdfPath, "utf8")).toBe("利用者が管理するPDF");
    await expect(loadKeiriData(dataRoot)).resolves.toMatchObject({
      invoices: [],
    });
  });

  it.each([
    { description: "最新番号", deletedIndex: 2, nextSequence: "03" },
    { description: "途中の番号", deletedIndex: 1, nextSequence: "04" },
  ])(
    "$description を削除した後は $nextSequence を採番する",
    async ({ deletedIndex, nextSequence }) => {
      const gateway = new FileInvoiceCreationGateway(dataRoot);
      const input = {
        businessPartnerCode: "ACME",
        paymentDueDate: "2026-11-30",
        today: "2026-10-25",
      };
      const drafts = [];
      for (let index = 0; index < 3; index += 1) {
        drafts.push(await createInvoiceDraft(gateway, input));
      }
      const target = drafts[deletedIndex];
      await deleteInvoiceDraft(new FileInvoiceDeletionGateway(dataRoot), {
        invoiceNumber: target.invoice.invoiceNumber,
        expectedRevision: target.invoice.revision,
      });
      const next = await createInvoiceDraft(gateway, input);
      expect(next.invoice.invoiceNumber).toBe(`ACME-202610-${nextSequence}`);
      for (const draft of drafts.filter((_, index) => index !== deletedIndex)) {
        expect(
          parseYaml(
            await readFile(join(dataRoot, draft.filePath), "utf8"),
            draft.filePath,
            invoiceSchema,
          ),
        ).toEqual(draft.invoice);
      }
    },
  );

  it("削除に失敗した場合は元のYAMLを維持する", async () => {
    const draft = await createPopulatedDraft();
    const original = await readFile(join(dataRoot, draft.filePath), "utf8");
    const failure = new Error("YAMLを削除できません。");
    vi.mocked(unlink).mockRejectedValueOnce(failure);
    await expect(
      deleteInvoiceDraft(new FileInvoiceDeletionGateway(dataRoot), {
        invoiceNumber: draft.invoice.invoiceNumber,
        expectedRevision: draft.invoice.revision,
      }),
    ).rejects.toBe(failure);
    expect(await readFile(join(dataRoot, draft.filePath), "utf8")).toBe(
      original,
    );
    expect(await readdir(join(dataRoot, "sales/invoices/2026"))).toEqual([
      "ACME-202610-01.yaml",
    ]);
  });

  it("発行済み請求書の削除を拒否し、YAMLと正式PDFを維持する", async () => {
    const issued = await createIssuedInvoice();
    const originalYaml = await readFile(
      join(dataRoot, issued.invoiceFilePath),
      "utf8",
    );
    const originalPdf = await readFile(join(dataRoot, issued.pdfFilePath));
    await expect(
      deleteInvoiceDraft(new FileInvoiceDeletionGateway(dataRoot), {
        invoiceNumber: issued.invoice.invoiceNumber,
        expectedRevision: issued.invoice.revision,
      }),
    ).rejects.toThrow("請求書を削除できません");
    expect(await readFile(join(dataRoot, issued.invoiceFilePath), "utf8")).toBe(
      originalYaml,
    );
    expect(await readFile(join(dataRoot, issued.pdfFilePath))).toEqual(
      originalPdf,
    );
  });
});

async function createPdf(pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage();
  }
  return document.save();
}

describe("ファイルシステムを使う入金管理", () => {
  it("入金完了日の記録・更新・削除で請求内容と正式PDFを維持し、削除後は下書きへ戻せる", async () => {
    const issued = await createIssuedInvoice();
    const originalPdf = await readFile(join(dataRoot, issued.pdfFilePath));
    const gateway = new FileInvoicePaymentGateway(dataRoot);
    let current = issued.invoice;
    for (const date of ["2026-10-25", "2025-01-01", null]) {
      const target = {
        invoiceNumber: current.invoiceNumber,
        expectedRevision: current.revision,
      };
      const result =
        date === null
          ? await deleteInvoicePaymentCompletedDate(gateway, target)
          : await setInvoicePaymentCompletedDate(gateway, {
              ...target,
              paymentCompletedDate: date,
              today: "2026-10-25",
            });

      expect(result.invoice).toEqual({
        ...current,
        revision: current.revision + 1,
        paymentCompletedDate: date,
      });
      expect(result.filePath).toBe(issued.invoiceFilePath);
      const source = await readFile(join(dataRoot, result.filePath), "utf8");
      expect(parseYaml(source, result.filePath, invoiceSchema)).toEqual(
        result.invoice,
      );
      expect(await readFile(join(dataRoot, issued.pdfFilePath))).toEqual(
        originalPdf,
      );
      await expect(loadKeiriData(dataRoot)).resolves.toMatchObject({
        invoices: [{ data: result.invoice }],
      });
      if (date !== null) {
        await expect(
          revertInvoiceToDraft(new FileInvoiceRevertToDraftGateway(dataRoot), {
            invoiceNumber: result.invoice.invoiceNumber,
            expectedRevision: result.invoice.revision,
          }),
        ).rejects.toMatchObject({
          issues: [expect.objectContaining({ path: ["paymentCompletedDate"] })],
        });
      }
      current = result.invoice;
    }

    const reverted = await revertInvoiceToDraft(
      new FileInvoiceRevertToDraftGateway(dataRoot),
      {
        invoiceNumber: current.invoiceNumber,
        expectedRevision: current.revision,
      },
    );
    expect(reverted.invoice.status).toBe("draft");
  });

  it.each(["set", "delete"] as const)(
    "%s のYAML反映に失敗した場合は元のYAMLとPDFを維持し、一時ファイルを残さない",
    async (action) => {
      const issued = await createIssuedInvoice();
      const gateway = new FileInvoicePaymentGateway(dataRoot);
      const recorded = await setInvoicePaymentCompletedDate(gateway, {
        invoiceNumber: issued.invoice.invoiceNumber,
        expectedRevision: issued.invoice.revision,
        paymentCompletedDate: "2026-10-24",
        today: "2026-10-25",
      });
      const originalYaml = await readFile(
        join(dataRoot, recorded.filePath),
        "utf8",
      );
      const originalPdf = await readFile(join(dataRoot, issued.pdfFilePath));
      const failure = new Error("YAMLを反映できません。");
      vi.mocked(rename).mockRejectedValueOnce(failure);
      const target = {
        invoiceNumber: recorded.invoice.invoiceNumber,
        expectedRevision: recorded.invoice.revision,
      };
      await expect(
        action === "set"
          ? setInvoicePaymentCompletedDate(gateway, {
              ...target,
              paymentCompletedDate: "2026-10-25",
              today: "2026-10-25",
            })
          : deleteInvoicePaymentCompletedDate(gateway, target),
      ).rejects.toBe(failure);

      expect(await readFile(join(dataRoot, recorded.filePath), "utf8")).toBe(
        originalYaml,
      );
      expect(await readFile(join(dataRoot, issued.pdfFilePath))).toEqual(
        originalPdf,
      );
      expect(await readdir(join(dataRoot, "sales/invoices/2025"))).toEqual([
        "ACME-202610-01.yaml",
      ]);
    },
  );
});

async function createIssuedInvoice() {
  const draft = await createPopulatedDraft();
  const updated = await updateInvoiceDraft(
    new FileInvoiceUpdateGateway(dataRoot),
    draft.invoice.invoiceNumber,
    {
      ...draft.invoice,
      transactionDate: "2025-12-31",
      pdf: { fileNameOverride: "発行時の個別名", issuedFileName: null },
    },
  );
  return issueInvoice(
    new FileInvoiceIssueGateway(dataRoot),
    {
      async renderSinglePagePdf() {
        return createPdf(1);
      },
    },
    {
      invoiceNumber: updated.invoice.invoiceNumber,
      expectedRevision: updated.invoice.revision,
      today: "2026-10-25",
    },
  );
}

describe("ファイルシステムを使う請求書の下書き戻し", () => {
  it("取引年の記録済みPDFだけを破棄し、同じ番号で編集と再発行ができる", async () => {
    const issued = await createIssuedInvoice();
    const pdfDirectory = join(dataRoot, "documents/2025/sales/invoices/ACME");
    await writeFile(
      join(pdfDirectory, "利用者管理.pdf"),
      "利用者が管理する書類",
    );
    await writeFile(
      join(dataRoot, "business-partners/ACME.yaml"),
      serializeBusinessPartner({
        ...partner,
        pdfFileNamePattern: "変更後-{sequence}",
      }),
    );

    const result = await revertInvoiceToDraft(
      new FileInvoiceRevertToDraftGateway(dataRoot),
      {
        invoiceNumber: issued.invoice.invoiceNumber,
        expectedRevision: issued.invoice.revision,
      },
    );

    expect(result).toMatchObject({
      invoice: {
        invoiceNumber: issued.invoice.invoiceNumber,
        revision: issued.invoice.revision + 1,
        status: "draft",
        pdf: { fileNameOverride: "発行時の個別名", issuedFileName: null },
      },
      invoiceFilePath: issued.invoiceFilePath,
      pdfFilePath: issued.pdfFilePath,
    });
    const source = await readFile(
      join(dataRoot, result.invoiceFilePath),
      "utf8",
    );
    expect(parseYaml(source, result.invoiceFilePath, invoiceSchema)).toEqual(
      result.invoice,
    );
    expect(await readdir(pdfDirectory)).toEqual(["利用者管理.pdf"]);
    expect(await readFile(join(pdfDirectory, "利用者管理.pdf"), "utf8")).toBe(
      "利用者が管理する書類",
    );
    expect(await readdir(join(dataRoot, "sales/invoices/2025"))).toEqual([
      "ACME-202610-01.yaml",
    ]);
    await expect(loadKeiriData(dataRoot)).resolves.toMatchObject({
      invoices: [{ data: result.invoice }],
    });

    const edited = await updateInvoiceDraft(
      new FileInvoiceUpdateGateway(dataRoot),
      result.invoice.invoiceNumber,
      {
        ...result.invoice,
        notes: "再発行する内容",
        pdf: { fileNameOverride: "再発行の名前", issuedFileName: null },
      },
    );
    const reissued = await issueInvoice(
      new FileInvoiceIssueGateway(dataRoot),
      {
        async renderSinglePagePdf() {
          return createPdf(1);
        },
      },
      {
        invoiceNumber: edited.invoice.invoiceNumber,
        expectedRevision: edited.invoice.revision,
        today: "2026-10-25",
      },
    );
    expect(reissued.invoice.invoiceNumber).toBe(issued.invoice.invoiceNumber);
    expect(reissued.invoice.notes).toBe("再発行する内容");
    expect(reissued.pdfFilePath).toBe(
      "documents/2025/sales/invoices/ACME/再発行の名前.pdf",
    );
  });

  it.each(["PDFの退避", "YAMLの反映", "PDFの破棄"])(
    "%s に失敗した場合は元のYAMLとPDFを復元し、一時ファイルを残さない",
    async (phase) => {
      const issued = await createIssuedInvoice();
      const invoicePath = join(dataRoot, issued.invoiceFilePath);
      const pdfPath = join(dataRoot, issued.pdfFilePath);
      const originalYaml = `# 元の書式も復元する\n${await readFile(invoicePath, "utf8")}`;
      await writeFile(invoicePath, originalYaml);
      const originalPdf = await readFile(pdfPath);
      const failure = new Error(`${phase}に失敗しました。`);
      if (phase === "PDFの退避") {
        vi.mocked(rename).mockRejectedValueOnce(failure);
      } else if (phase === "YAMLの反映") {
        vi.mocked(rename)
          .mockImplementationOnce(actualFileSystem.rename)
          .mockRejectedValueOnce(failure);
      } else {
        vi.mocked(unlink).mockRejectedValueOnce(failure);
      }

      await expect(
        revertInvoiceToDraft(new FileInvoiceRevertToDraftGateway(dataRoot), {
          invoiceNumber: issued.invoice.invoiceNumber,
          expectedRevision: issued.invoice.revision,
        }),
      ).rejects.toBe(failure);

      expect(await readFile(invoicePath, "utf8")).toBe(originalYaml);
      expect(await readFile(pdfPath)).toEqual(originalPdf);
      expect(await readdir(join(dataRoot, "sales/invoices/2025"))).toEqual([
        "ACME-202610-01.yaml",
      ]);
      expect(
        await readdir(join(dataRoot, "documents/2025/sales/invoices/ACME")),
      ).toEqual(["発行時の個別名.pdf"]);
      await expect(loadKeiriData(dataRoot)).resolves.toMatchObject({
        invoices: [{ data: issued.invoice }],
      });
    },
  );

  it.each([
    {
      reason: "リビジョン不一致",
      revisionOffset: -1,
      paymentCompletedDate: null,
    },
    {
      reason: "入金完了日あり",
      revisionOffset: 0,
      paymentCompletedDate: "2026-10-24",
    },
  ])(
    "$reason ではPDFとYAMLを変更しない",
    async ({ revisionOffset, paymentCompletedDate }) => {
      const issued = await createIssuedInvoice();
      if (paymentCompletedDate !== null) {
        await writeFile(
          join(dataRoot, issued.invoiceFilePath),
          serializeInvoice({ ...issued.invoice, paymentCompletedDate }),
        );
      }
      const originalYaml = await readFile(
        join(dataRoot, issued.invoiceFilePath),
        "utf8",
      );
      const originalPdf = await readFile(join(dataRoot, issued.pdfFilePath));
      await expect(
        revertInvoiceToDraft(new FileInvoiceRevertToDraftGateway(dataRoot), {
          invoiceNumber: issued.invoice.invoiceNumber,
          expectedRevision: issued.invoice.revision + revisionOffset,
        }),
      ).rejects.toThrow("下書きへ戻せません");
      expect(
        await readFile(join(dataRoot, issued.invoiceFilePath), "utf8"),
      ).toBe(originalYaml);
      expect(await readFile(join(dataRoot, issued.pdfFilePath))).toEqual(
        originalPdf,
      );
    },
  );
});
