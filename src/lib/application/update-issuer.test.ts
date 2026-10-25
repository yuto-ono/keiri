import { describe, expect, it, vi } from "vitest";

import { createIssuer, createPartner } from "#lib/testing/business-partners";
import {
  updateIssuer,
  type IssuerUpdateContext,
  type IssuerUpdateGateway,
} from "./update-issuer";

function createHarness() {
  const context: IssuerUpdateContext = {
    issuer: createIssuer(),
    businessPartners: [createPartner()],
  };
  const saveUpdatedIssuer = vi.fn<IssuerUpdateGateway["saveUpdatedIssuer"]>(
    async () => ({ filePath: "issuers/issuer.yaml" }),
  );
  const loadUpdateContext = vi.fn<IssuerUpdateGateway["loadUpdateContext"]>(
    async () => context,
  );
  return {
    context,
    gateway: { loadUpdateContext, saveUpdatedIssuer },
    loadUpdateContext,
    saveUpdatedIssuer,
  };
}

describe("発行者・振込先の更新", () => {
  it("氏名・連絡先・口座情報・既定を更新し、IDを保持してリビジョンを進める", async () => {
    const harness = createHarness();
    const before = structuredClone(harness.context);
    const proposed = {
      ...createIssuer(),
      name: "変更後の発行者",
      registrationNumber: "T1234567890123",
      phone: "電話連絡は別途案内",
      email: "メール連絡は別途案内",
      bankAccounts: [
        createIssuer().bankAccounts[1],
        {
          ...createIssuer().bankAccounts[0],
          bankName: "変更後の銀行",
          branchCode: "007",
          accountNumber: "0001234",
        },
      ],
      defaultBankAccountId: "secondary",
    };
    const result = await updateIssuer(harness.gateway, "issuer", proposed);
    expect(result).toEqual({
      issuer: { ...proposed, revision: 2 },
      filePath: "issuers/issuer.yaml",
    });
    expect(harness.loadUpdateContext).toHaveBeenCalledWith("issuer");
    expect(harness.saveUpdatedIssuer).toHaveBeenCalledWith(
      before.issuer,
      result.issuer,
    );
    expect(harness.context).toEqual(before);
  });

  it("新しい振込先をID付きで追加できる", async () => {
    const harness = createHarness();
    const result = await updateIssuer(harness.gateway, "issuer", {
      ...createIssuer(),
      bankAccounts: [
        ...createIssuer().bankAccounts,
        { ...createIssuer().bankAccounts[0], id: "third" },
      ],
    });
    expect(result.issuer.bankAccounts.map((account) => account.id)).toEqual([
      "primary",
      "secondary",
      "third",
    ]);
  });

  it("参照されていない連絡先・非既定口座は削除できる", async () => {
    const harness = createHarness();
    const result = await updateIssuer(harness.gateway, "issuer", {
      ...createIssuer(),
      phone: null,
      bankAccounts: [createIssuer().bankAccounts[0]],
    });
    expect(result.issuer.phone).toBeNull();
    expect(result.issuer.bankAccounts.map((account) => account.id)).toEqual([
      "primary",
    ]);
  });

  it("取引先で表示中の電話番号・メールアドレスの削除を拒否する", async () => {
    const harness = createHarness();
    harness.context.issuer = { ...createIssuer(), email: "連絡先" };
    harness.context.businessPartners = [
      createPartner({
        issuerDisplay: {
          phone: true,
          email: true,
          bankAccountIds: ["primary"],
        },
      }),
    ];
    await expect(
      updateIssuer(harness.gateway, "issuer", {
        ...createIssuer(),
        phone: null,
        email: null,
      }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: ["phone"],
          message: expect.stringContaining("ACME"),
        }),
        expect.objectContaining({
          path: ["email"],
          message: expect.stringContaining("ACME"),
        }),
      ]),
    });
    expect(harness.saveUpdatedIssuer).not.toHaveBeenCalled();
  });

  it("参照されている口座は既定を変えても削除できない", async () => {
    const harness = createHarness();
    await expect(
      updateIssuer(harness.gateway, "issuer", {
        ...createIssuer(),
        bankAccounts: [createIssuer().bankAccounts[1]],
        defaultBankAccountId: "secondary",
      }),
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          path: ["bankAccounts"],
          message: expect.stringContaining("primary"),
        }),
      ],
    });
    expect(harness.saveUpdatedIssuer).not.toHaveBeenCalled();
  });

  it("既定口座が残らない保存と、振込先0件を拒否する", async () => {
    const harness = createHarness();
    harness.context.businessPartners = [];
    await expect(
      updateIssuer(harness.gateway, "issuer", {
        ...createIssuer(),
        bankAccounts: [createIssuer().bankAccounts[1]],
      }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["defaultBankAccountId"] })],
    });
    await expect(
      updateIssuer(harness.gateway, "issuer", {
        ...createIssuer(),
        bankAccounts: [],
      }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["defaultBankAccountId"] }),
        expect.objectContaining({ path: ["bankAccounts"] }),
      ]),
    });
    expect(harness.saveUpdatedIssuer).not.toHaveBeenCalled();
  });

  it("大文字・小文字だけの変更も含めて発行者IDの変更を拒否する", async () => {
    const harness = createHarness();
    await expect(
      updateIssuer(harness.gateway, "issuer", {
        ...createIssuer(),
        id: "Issuer",
      }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["id"] })],
    });
    expect(harness.saveUpdatedIssuer).not.toHaveBeenCalled();
  });

  it("大文字・小文字を区別せず振込先IDの重複を拒否する", async () => {
    const harness = createHarness();
    await expect(
      updateIssuer(harness.gateway, "issuer", {
        ...createIssuer(),
        bankAccounts: [
          ...createIssuer().bankAccounts,
          { ...createIssuer().bankAccounts[0], id: "PRIMARY" },
        ],
      }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["bankAccounts", 2, "id"] }),
      ]),
    });
    expect(harness.saveUpdatedIssuer).not.toHaveBeenCalled();
  });

  it("未参照の振込先でも登録済みIDの表記は変更できない", async () => {
    const harness = createHarness();
    const proposed = createIssuer();
    proposed.bankAccounts[1].id = "SECONDARY";
    await expect(
      updateIssuer(harness.gateway, "issuer", proposed),
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          path: ["bankAccounts", 1, "id"],
          message: expect.stringContaining("変更できません"),
        }),
      ],
    });
    expect(harness.saveUpdatedIssuer).not.toHaveBeenCalled();
  });

  it("必須項目と登録番号・口座番号の形式を保存前に再検証する", async () => {
    const harness = createHarness();
    const issuer = createIssuer();
    issuer.name = "";
    issuer.registrationNumber = "t123";
    issuer.phone = "";
    issuer.bankAccounts[1] = {
      ...issuer.bankAccounts[1],
      id: "bad--id",
      bankName: "",
      branchName: "",
      accountHolderName: "",
      branchCode: "7",
      accountNumber: "123",
    };
    await expect(
      updateIssuer(harness.gateway, "issuer", issuer),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["name"] }),
        expect.objectContaining({ path: ["registrationNumber"] }),
        expect.objectContaining({ path: ["phone"] }),
        expect.objectContaining({ path: ["bankAccounts", 1, "id"] }),
        expect.objectContaining({ path: ["bankAccounts", 1, "branchCode"] }),
        expect.objectContaining({ path: ["bankAccounts", 1, "accountNumber"] }),
      ]),
    });
    expect(harness.saveUpdatedIssuer).not.toHaveBeenCalled();
  });

  it.each([0, 1.5, 2])(
    "期待リビジョン %s が不正・不一致なら保存しない",
    async (revision) => {
      const harness = createHarness();
      await expect(
        updateIssuer(harness.gateway, "issuer", {
          ...createIssuer(),
          revision,
        }),
      ).rejects.toMatchObject({
        issues: [expect.objectContaining({ path: ["revision"] })],
      });
      expect(harness.saveUpdatedIssuer).not.toHaveBeenCalled();
    },
  );

  it("存在しない発行者を拒否する", async () => {
    const harness = createHarness();
    harness.context.issuer = undefined;
    await expect(
      updateIssuer(harness.gateway, "MISSING", createIssuer()),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["id"] })],
    });
    expect(harness.saveUpdatedIssuer).not.toHaveBeenCalled();
  });

  it("書き込み失敗時に元の発行者と取引先を変更しない", async () => {
    const harness = createHarness();
    const before = structuredClone(harness.context);
    const failure = new Error("保存できません。");
    harness.saveUpdatedIssuer.mockRejectedValueOnce(failure);
    await expect(
      updateIssuer(harness.gateway, "issuer", {
        ...createIssuer(),
        name: "変更後",
      }),
    ).rejects.toBe(failure);
    expect(harness.context).toEqual(before);
  });
});
