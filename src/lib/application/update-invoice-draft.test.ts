import { describe, expect, it } from "vitest";

import { DomainValidationError } from "../domain/domain-validation-error";
import type { Invoice, Issuer, TaxCategory } from "../domain/model";
import {
  type InvoiceUpdateGateway,
  updateInvoiceDraft,
} from "./update-invoice-draft";

const primaryAccount = {
  id: "primary",
  bankName: "第一銀行",
  branchName: "本店",
  branchCode: "001",
  accountType: "ordinary" as const,
  accountNumber: "1234567",
  accountHolderName: "ヤマダタロウ",
};
const secondaryAccount = {
  id: "secondary",
  bankName: "第二銀行",
  branchName: "本店",
  branchCode: null,
  accountType: "checking" as const,
  accountNumber: "7654321",
  accountHolderName: "ヤマダタロウ",
};

const issuer: Issuer = {
  revision: 1,
  id: "issuer",
  name: "山田太郎",
  registrationNumber: "T0000000000000",
  phone: "00-0000-0000",
  email: null,
  bankAccounts: [primaryAccount, secondaryAccount],
  defaultBankAccountId: "primary",
};

const standardTaxCategory: TaxCategory = {
  id: "standard-10",
  name: "標準10%",
  treatment: "taxable",
  deprecated: false,
  isStandardRate: true,
  ratePercent: 10,
};

function createInvoice(): Invoice {
  return {
    revision: 3,
    status: "draft",
    invoiceNumber: "ACME-202610-01",
    businessPartner: {
      code: "ACME",
      snapshot: { addressee: "株式会社サンプル", honorific: "御中" },
    },
    issuer: {
      id: "issuer",
      snapshot: {
        name: "山田太郎",
        registrationNumber: "T0000000000000",
        phone: { visible: true, value: "00-0000-0000" },
        email: { visible: false },
        bankAccounts: [primaryAccount],
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
}

function createGateway(
  currentInvoice: Invoice | undefined = createInvoice(),
  taxCategories: readonly TaxCategory[] = [standardTaxCategory],
) {
  let saved: { currentInvoice: Invoice; updatedInvoice: Invoice } | undefined;
  const gateway: InvoiceUpdateGateway = {
    async loadUpdateContext() {
      return { invoice: currentInvoice, issuer, taxCategories };
    },
    async saveUpdatedInvoice(current, updated) {
      saved = { currentInvoice: current, updatedInvoice: updated };
      return {
        filePath: `sales/invoices/${updated.transactionDate.slice(0, 4)}/${updated.invoiceNumber}.yaml`,
      };
    },
  };
  return { gateway, saved: () => saved };
}

describe("請求書下書きの更新", () => {
  it("編集可能な内容を保存しリビジョンを1増やす", async () => {
    const current = createInvoice();
    const proposed: Invoice = {
      ...current,
      issueDate: "2026-10-31",
      transactionDate: "2025-12-31",
      paymentDueDate: "2026-01-31",
      unitPricesIncludeTax: true,
      lineItems: [
        {
          name: "システム開発業務",
          quantity: 10.5,
          unit: "時間",
          unitPrice: 10_000,
          taxCategoryId: "standard-10",
        },
      ],
      notes: "備考",
      pdf: { ...current.pdf, fileNameOverride: "請求書 個別名" },
    };
    const harness = createGateway(current);
    const result = await updateInvoiceDraft(
      harness.gateway,
      current.invoiceNumber,
      proposed,
    );

    expect(result.invoice.revision).toBe(4);
    expect(result.invoice.transactionDate).toBe("2025-12-31");
    expect(result.invoice.lineItems).toEqual(proposed.lineItems);
    expect(result.filePath).toBe("sales/invoices/2025/ACME-202610-01.yaml");
    expect(harness.saved()).toEqual({
      currentInvoice: current,
      updatedInvoice: result.invoice,
    });
  });

  it("期待リビジョンの不一致を拒否する", async () => {
    const current = createInvoice();
    const harness = createGateway(current);
    await expect(
      updateInvoiceDraft(harness.gateway, current.invoiceNumber, {
        ...current,
        revision: 2,
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);
    expect(harness.saved()).toBeUndefined();
  });

  it("請求書番号、取引先、状態、端数処理、発行年月の変更をまとめて拒否する", async () => {
    const current = createInvoice();
    const proposed: Invoice = {
      ...current,
      status: "issued",
      invoiceNumber: "OTHER-202611-01",
      businessPartner: {
        ...current.businessPartner,
        code: "OTHER",
      },
      issueDate: "2026-11-01",
      rounding: { ...current.rounding, lineAmount: "ceil" },
      pdf: { ...current.pdf, issuedFileName: "invoice.pdf" },
    };
    const harness = createGateway(current);

    try {
      await updateInvoiceDraft(
        harness.gateway,
        current.invoiceNumber,
        proposed,
      );
      expect.fail("DomainValidationError が必要です");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainValidationError);
      const paths = (error as DomainValidationError).issues.map((issue) =>
        issue.path.join("."),
      );
      expect(paths).toEqual(
        expect.arrayContaining([
          "invoiceNumber",
          "status",
          "pdf.issuedFileName",
          "businessPartner",
          "rounding",
          "issueDate",
        ]),
      );
    }
    expect(harness.saved()).toBeUndefined();
  });

  it("発行済み請求書を更新できない", async () => {
    const current: Invoice = {
      ...createInvoice(),
      status: "issued",
      pdf: { fileNameOverride: null, issuedFileName: "invoice.pdf" },
    };
    const harness = createGateway(current);
    await expect(
      updateInvoiceDraft(harness.gateway, current.invoiceNumber, current),
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("登録済み振込先の追加と並べ替えを許可する", async () => {
    const current = createInvoice();
    const proposed: Invoice = {
      ...current,
      issuer: {
        ...current.issuer,
        snapshot: {
          ...current.issuer.snapshot,
          bankAccounts: [secondaryAccount, primaryAccount],
        },
      },
    };
    const harness = createGateway(current);
    const result = await updateInvoiceDraft(
      harness.gateway,
      current.invoiceNumber,
      proposed,
    );
    expect(
      result.invoice.issuer.snapshot.bankAccounts.map((account) => account.id),
    ).toEqual(["secondary", "primary"]);
  });

  it("振込先の登録情報の上書きを拒否する", async () => {
    const current = createInvoice();
    const proposed: Invoice = {
      ...current,
      issuer: {
        ...current.issuer,
        snapshot: {
          ...current.issuer.snapshot,
          bankAccounts: [
            primaryAccount,
            { ...secondaryAccount, bankName: "上書き銀行" },
          ],
        },
      },
    };
    await expect(
      updateInvoiceDraft(
        createGateway(current).gateway,
        current.invoiceNumber,
        proposed,
      ),
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("複数税区分と不正な数量をまとめて拒否する", async () => {
    const current = createInvoice();
    const proposed: Invoice = {
      ...current,
      lineItems: [
        {
          name: "業務A",
          quantity: 0,
          unit: "式",
          unitPrice: 1_000,
          taxCategoryId: "standard-10",
        },
        {
          name: "業務B",
          quantity: 1,
          unit: "式",
          unitPrice: 1_000,
          taxCategoryId: "other",
        },
      ],
    };
    try {
      await updateInvoiceDraft(
        createGateway(current).gateway,
        current.invoiceNumber,
        proposed,
      );
      expect.fail("DomainValidationError が必要です");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainValidationError);
      expect((error as DomainValidationError).issues).toHaveLength(2);
    }
  });

  it("廃止済みの標準税率を参照する既存明細も計算できる", async () => {
    const current = createInvoice();
    const proposed: Invoice = {
      ...current,
      lineItems: [
        {
          name: "業務",
          quantity: 1,
          unit: "式",
          unitPrice: 1_000,
          taxCategoryId: "standard-10",
        },
      ],
    };
    const deprecated = { ...standardTaxCategory, deprecated: true };
    await expect(
      updateInvoiceDraft(
        createGateway(current, [deprecated]).gateway,
        current.invoiceNumber,
        proposed,
      ),
    ).resolves.toBeDefined();
  });
});
