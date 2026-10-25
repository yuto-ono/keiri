import { describe, expect, it, vi } from "vitest";

import {
  createInvoiceForPartner,
  createIssuer,
  createPartner,
} from "#lib/testing/business-partners";
import {
  createBusinessPartner,
  deleteBusinessPartner,
  updateBusinessPartner,
  type BusinessPartnerManagementContext,
  type BusinessPartnerManagementGateway,
  type CreateBusinessPartnerInput,
} from "./manage-business-partners";

function createHarness() {
  const context: BusinessPartnerManagementContext = {
    businessPartners: [createPartner()],
    issuers: [createIssuer()],
    invoices: [],
  };
  const saveNewBusinessPartner = vi.fn<
    BusinessPartnerManagementGateway["saveNewBusinessPartner"]
  >(async (partner) => ({
    filePath: `business-partners/${partner.code}.yaml`,
  }));
  const saveUpdatedBusinessPartner = vi.fn<
    BusinessPartnerManagementGateway["saveUpdatedBusinessPartner"]
  >(async (_current, updated) => ({
    filePath: `business-partners/${updated.code}.yaml`,
  }));
  const remove = vi.fn<
    BusinessPartnerManagementGateway["deleteBusinessPartner"]
  >(async (partner) => ({
    filePath: `business-partners/${partner.code}.yaml`,
  }));
  const gateway: BusinessPartnerManagementGateway = {
    async loadManagementContext() {
      return context;
    },
    saveNewBusinessPartner,
    saveUpdatedBusinessPartner,
    deleteBusinessPartner: remove,
  };
  return {
    context,
    gateway,
    saveNewBusinessPartner,
    saveUpdatedBusinessPartner,
    remove,
  };
}

function createInput(): CreateBusinessPartnerInput {
  return {
    code: "NewCo",
    addressee: "新しい取引先",
    honorific: "様",
    requiresMonthlyInvoice: false,
    unitPricesIncludeTax: true,
  };
}

describe("取引先管理", () => {
  it("初期値を発行者から取得し、表記を保持したコードでrevision 1を登録する", async () => {
    const harness = createHarness();
    const result = await createBusinessPartner(harness.gateway, createInput());
    expect(result).toEqual({
      businessPartner: {
        ...createInput(),
        revision: 1,
        billingInstructions: null,
        issuerDisplay: {
          phone: true,
          email: false,
          bankAccountIds: ["primary"],
        },
        pdfFileNamePattern:
          "{businessPartnerCode}-{issueDate:YYYYMM}-{sequence}",
      },
      filePath: "business-partners/NewCo.yaml",
    });
    expect(harness.saveNewBusinessPartner).toHaveBeenCalledWith(
      result.businessPartner,
    );
  });

  it("新規登録時の明示した表示設定・口座順・命名規則を保持する", async () => {
    const harness = createHarness();
    const input = {
      ...createInput(),
      issuerDisplay: {
        phone: false,
        email: false,
        bankAccountIds: ["secondary", "primary"],
      },
      pdfFileNamePattern: "請求-{sequence}",
      billingInstructions: "契約に基づいて請求する",
    };
    const result = await createBusinessPartner(harness.gateway, input);
    expect(result.businessPartner).toEqual({ ...input, revision: 1 });
  });

  it.each(["create", "update"])(
    "%s で大文字・小文字を区別せずコードの重複を拒否する",
    async (operation) => {
      const harness = createHarness();
      harness.context.businessPartners = [
        createPartner(),
        createPartner({ code: "OTHER" }),
      ];
      const result =
        operation === "create"
          ? createBusinessPartner(harness.gateway, {
              ...createInput(),
              code: "other",
            })
          : updateBusinessPartner(
              harness.gateway,
              "ACME",
              createPartner({ code: "other" }),
            );
      await expect(result).rejects.toMatchObject({
        issues: [expect.objectContaining({ path: ["code"] })],
      });
      expect(harness.saveNewBusinessPartner).not.toHaveBeenCalled();
      expect(harness.saveUpdatedBusinessPartner).not.toHaveBeenCalled();
    },
  );

  it("存在しない連絡先・口座と口座の重複をまとめて拒否する", async () => {
    const harness = createHarness();
    harness.context.issuers = [{ ...createIssuer(), phone: null }];
    await expect(
      createBusinessPartner(harness.gateway, {
        ...createInput(),
        issuerDisplay: {
          phone: true,
          email: true,
          bankAccountIds: ["missing", "missing"],
        },
      }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["issuerDisplay", "phone"] }),
        expect.objectContaining({ path: ["issuerDisplay", "email"] }),
        expect.objectContaining({
          path: ["issuerDisplay", "bankAccountIds", 0],
        }),
        expect.objectContaining({ message: expect.stringContaining("重複") }),
      ]),
    });
    expect(harness.saveNewBusinessPartner).not.toHaveBeenCalled();
  });

  it("入力値と命名規則を保存前に再検証する", async () => {
    const harness = createHarness();
    await expect(
      createBusinessPartner(harness.gateway, {
        ...createInput(),
        code: "bad/code",
        addressee: "",
        billingInstructions: "",
        pdfFileNamePattern: "{unknown}",
        issuerDisplay: { phone: false, email: false, bankAccountIds: [] },
      }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["code"] }),
        expect.objectContaining({ path: ["addressee"] }),
        expect.objectContaining({ path: ["billingInstructions"] }),
        expect.objectContaining({ path: ["pdfFileNamePattern"] }),
        expect.objectContaining({ path: ["issuerDisplay", "bankAccountIds"] }),
      ]),
    });
    expect(harness.saveNewBusinessPartner).not.toHaveBeenCalled();
  });

  it.each(["draft", "issued"] as const)(
    "%s の請求書が参照していればコード変更・削除を拒否する",
    async (status) => {
      const harness = createHarness();
      harness.context.invoices = [
        createInvoiceForPartner(createPartner(), status),
      ];
      await expect(
        updateBusinessPartner(
          harness.gateway,
          "ACME",
          createPartner({ code: "acme" }),
        ),
      ).rejects.toMatchObject({
        issues: [expect.objectContaining({ path: ["code"] })],
      });
      await expect(
        deleteBusinessPartner(harness.gateway, {
          code: "ACME",
          expectedRevision: 1,
        }),
      ).rejects.toMatchObject({
        issues: [expect.objectContaining({ path: ["code"] })],
      });
      expect(harness.saveUpdatedBusinessPartner).not.toHaveBeenCalled();
      expect(harness.remove).not.toHaveBeenCalled();
    },
  );

  it("参照中も宛名や表示設定を更新でき、既存請求書と初期選択を暗黙に変更しない", async () => {
    const harness = createHarness();
    harness.context.invoices = [createInvoiceForPartner()];
    harness.context.issuers = [
      { ...createIssuer(), defaultBankAccountId: "secondary" },
    ];
    const before = structuredClone(harness.context);
    const result = await updateBusinessPartner(
      harness.gateway,
      "ACME",
      createPartner({
        addressee: "新しい宛名",
        honorific: "様",
        unitPricesIncludeTax: true,
      }),
    );
    expect(result.businessPartner).toMatchObject({
      revision: 2,
      addressee: "新しい宛名",
      issuerDisplay: { bankAccountIds: ["primary"] },
    });
    expect(harness.context).toEqual(before);
  });

  it("未参照ならコード変更と削除ができる", async () => {
    const harness = createHarness();
    const renamed = await updateBusinessPartner(
      harness.gateway,
      "ACME",
      createPartner({ code: "acme" }),
    );
    expect(renamed).toMatchObject({
      businessPartner: { code: "acme", revision: 2 },
      filePath: "business-partners/acme.yaml",
    });
    expect(
      await deleteBusinessPartner(harness.gateway, {
        code: "ACME",
        expectedRevision: 1,
      }),
    ).toEqual({ code: "ACME", filePath: "business-partners/ACME.yaml" });
  });

  it.each([0, 1.5, 2])(
    "期待リビジョン %s が不正・不一致なら更新と削除を拒否する",
    async (expectedRevision) => {
      const harness = createHarness();
      await expect(
        updateBusinessPartner(
          harness.gateway,
          "ACME",
          createPartner({ revision: expectedRevision }),
        ),
      ).rejects.toMatchObject({
        issues: [expect.objectContaining({ path: ["revision"] })],
      });
      await expect(
        deleteBusinessPartner(harness.gateway, {
          code: "ACME",
          expectedRevision,
        }),
      ).rejects.toMatchObject({
        issues: [expect.objectContaining({ path: ["revision"] })],
      });
      expect(harness.saveUpdatedBusinessPartner).not.toHaveBeenCalled();
      expect(harness.remove).not.toHaveBeenCalled();
    },
  );

  it("存在しない取引先と発行者なしの登録を拒否する", async () => {
    const harness = createHarness();
    await expect(
      updateBusinessPartner(harness.gateway, "MISSING", createPartner()),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["code"] })],
    });
    await expect(
      deleteBusinessPartner(harness.gateway, {
        code: "MISSING",
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["code"] })],
    });
    harness.context.issuers = [];
    await expect(
      createBusinessPartner(harness.gateway, createInput()),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["issuers"] })],
    });
  });

  it("書き込み失敗を呼び出し元へ返し、元のデータを変更しない", async () => {
    const harness = createHarness();
    const before = structuredClone(harness.context);
    const error = new Error("書き込み失敗");
    harness.saveNewBusinessPartner.mockRejectedValueOnce(error);
    harness.saveUpdatedBusinessPartner.mockRejectedValueOnce(error);
    harness.remove.mockRejectedValueOnce(error);
    await expect(
      createBusinessPartner(harness.gateway, createInput()),
    ).rejects.toBe(error);
    await expect(
      updateBusinessPartner(
        harness.gateway,
        "ACME",
        createPartner({ addressee: "変更後" }),
      ),
    ).rejects.toBe(error);
    await expect(
      deleteBusinessPartner(harness.gateway, {
        code: "ACME",
        expectedRevision: 1,
      }),
    ).rejects.toBe(error);
    expect(harness.context).toEqual(before);
  });
});
