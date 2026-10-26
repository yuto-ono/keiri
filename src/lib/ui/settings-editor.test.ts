import { describe, expect, it, vi } from "vitest";
import type { IssuerUpdateGateway } from "#lib/application/update-issuer";
import type { SettingsUpdateGateway } from "#lib/application/update-settings";
import type { Settings } from "#lib/domain/model";
import { handleUpdateIssuerRequest } from "#lib/server/issuer-api";
import { handleUpdateSettingsRequest } from "#lib/server/settings-api";
import { createIssuer, createPartner } from "#lib/testing/business-partners";
import {
  appendIssuerBankAccount,
  createIssuerForm,
  createRoundingForm,
  prepareIssuerForm,
  saveIssuerForm,
  saveRoundingForm,
} from "./settings-editor";

function harness() {
  const current = {
    issuer: createIssuer(),
    settings: {
      revision: 1,
      rounding: { lineAmount: "floor", taxAmount: "floor" },
    } as Settings,
    partners: [createPartner()],
  };
  const saveUpdatedIssuer = vi.fn<IssuerUpdateGateway["saveUpdatedIssuer"]>(
    async (_saved, updated) => {
      current.issuer = updated;
      return { filePath: "issuers/issuer.yaml" };
    },
  );
  const saveSettings = vi.fn<SettingsUpdateGateway["saveSettings"]>(
    async (settings) => {
      current.settings = settings;
      return { filePath: "settings.yaml" };
    },
  );
  const issuerGateway: IssuerUpdateGateway = {
    loadUpdateContext: async () => ({
      issuer: current.issuer,
      businessPartners: current.partners,
    }),
    saveUpdatedIssuer,
  };
  const settingsGateway: SettingsUpdateGateway = {
    loadSettings: async () => current.settings,
    saveSettings,
  };
  const fetcher = vi.fn<typeof fetch>(async (path, init) => {
    const url = new URL(String(path), "http://127.0.0.1");
    const request = new Request(url, {
      ...init,
      headers: { ...init?.headers, origin: url.origin },
    });
    return url.pathname === "/api/settings"
      ? handleUpdateSettingsRequest(request, url, { gateway: settingsGateway })
      : handleUpdateIssuerRequest(request, url, "issuer", {
          gateway: issuerGateway,
        });
  });
  return { current, fetcher, saveUpdatedIssuer, saveSettings };
}

describe("設定画面のフォーム", () => {
  it("保存済みのIDと既定の振込先を保持し、任意項目のnullだけを空欄にする", () => {
    const saved = createIssuer();
    saved.defaultBankAccountId = "secondary";
    saved.bankAccounts[1].branchCode = null;
    const before = structuredClone(saved);
    const form = createIssuerForm(saved);
    expect(form).toMatchObject({
      email: "",
      defaultBankAccountKey: 1,
      bankAccounts: [
        { key: 0, savedId: "primary" },
        { key: 1, savedId: "secondary", branchCode: "" },
      ],
    });
    expect(form).not.toHaveProperty("id");
    expect(form).not.toHaveProperty("revision");
    form.bankAccounts[0].bankName = "入力中";
    expect(saved).toEqual(before);
  });
  it("新しい振込先は未入力で追加し、ID編集中も選択した既定を維持する", () => {
    const saved = createIssuer();
    const original = createIssuerForm(saved);
    const form = appendIssuerBankAccount(original);
    expect(original.bankAccounts).toHaveLength(2);
    expect(form.bankAccounts[2]).toMatchObject({
      savedId: null,
      id: "",
      accountType: "",
      accountNumber: "",
    });
    const added = form.bankAccounts[2];
    Object.assign(added, {
      id: "third",
      bankName: "追加銀行",
      branchName: "支店",
      branchCode: "007",
      accountType: "checking",
      accountNumber: "0001234",
      accountHolderName: "口座名義",
    });
    form.defaultBankAccountKey = added.key;
    added.id = "new-bank";
    expect(prepareIssuerForm(saved, form)).toMatchObject({
      ok: true,
      value: {
        defaultBankAccountId: "new-bank",
        bankAccounts: expect.arrayContaining([
          expect.objectContaining({
            id: "new-bank",
            branchCode: "007",
            accountNumber: "0001234",
            accountType: "checking",
          }),
        ]),
      },
    });
  });
  it("保存済みの振込先IDは編集用の値で置き換えず、公開データに画面用キーを含めない", () => {
    const saved = createIssuer();
    const form = createIssuerForm(saved);
    form.bankAccounts[0].id = "changed";
    const result = prepareIssuerForm(saved, form);
    expect(result).toEqual({ ok: true, value: saved });
  });
  it("連絡先に固有の形式検証を追加せず、空白と数字文字列の先頭の0を保持する", () => {
    const saved = createIssuer();
    const form = createIssuerForm(saved);
    form.name = " 発行者 ";
    form.phone = "電話は別途案内";
    form.email = "メールは別途案内";
    form.bankAccounts[0].branchCode = "007";
    form.bankAccounts[0].accountNumber = "0001234";
    form.bankAccounts[1].branchCode = "";
    expect(prepareIssuerForm(saved, form)).toMatchObject({
      ok: true,
      value: {
        name: form.name,
        phone: form.phone,
        email: form.email,
        bankAccounts: [
          { branchCode: "007", accountNumber: "0001234" },
          { branchCode: null },
        ],
      },
    });
  });
  it.each(["未選択の種別", "不正な番号", "ID重複", "既定なし"])(
    "%sを保存前に拒否して入力を保つ",
    async (invalid) => {
      const saved = createIssuer();
      const form = appendIssuerBankAccount(createIssuerForm(saved));
      Object.assign(form.bankAccounts[2], {
        id: "third",
        bankName: "銀行",
        branchName: "支店",
        accountType: "ordinary",
        accountNumber: "1234567",
        accountHolderName: "名義",
      });
      if (invalid === "未選択の種別") form.bankAccounts[2].accountType = "";
      if (invalid === "不正な番号") form.bankAccounts[2].accountNumber = "123";
      if (invalid === "ID重複") form.bankAccounts[2].id = "PRIMARY";
      if (invalid === "既定なし") form.defaultBankAccountKey = 99;
      const before = structuredClone({ saved, form });
      const fetcher = vi.fn<typeof fetch>();
      expect((await saveIssuerForm(fetcher, saved, form)).ok).toBe(false);
      expect(fetcher).not.toHaveBeenCalled();
      expect({ saved, form }).toEqual(before);
    },
  );
  it("発行者と端数処理を独立して保存し、他方の未保存内容を送信・変更しない", async () => {
    const test = harness();
    const savedIssuer = test.current.issuer;
    const savedSettings = test.current.settings;
    const issuerForm = createIssuerForm(savedIssuer);
    const roundingForm = createRoundingForm(savedSettings);
    issuerForm.name = "保存する発行者";
    roundingForm.lineAmount = "halfUp";
    expect(
      await saveIssuerForm(test.fetcher, savedIssuer, issuerForm),
    ).toMatchObject({
      ok: true,
      value: { issuer: { revision: 2, name: "保存する発行者", id: "issuer" } },
    });
    expect(test.fetcher).toHaveBeenCalledOnce();
    expect(test.fetcher.mock.calls[0][0]).toBe("/api/issuers/issuer");
    expect(test.fetcher.mock.calls[0][1]?.method).toBe("PUT");
    expect(JSON.parse(test.fetcher.mock.calls[0][1]?.body as string)).toEqual({
      ...savedIssuer,
      name: "保存する発行者",
    });
    expect(test.saveSettings).not.toHaveBeenCalled();
    expect(test.current.settings).toEqual(savedSettings);
    expect(roundingForm.lineAmount).toBe("halfUp");
    issuerForm.name = "まだ保存しない発行者";
    expect(
      await saveRoundingForm(test.fetcher, savedSettings, roundingForm),
    ).toMatchObject({
      ok: true,
      value: {
        settings: {
          revision: 2,
          rounding: { lineAmount: "halfUp", taxAmount: "floor" },
        },
      },
    });
    expect(test.fetcher).toHaveBeenCalledTimes(2);
    expect(test.fetcher.mock.calls[1][0]).toBe("/api/settings");
    expect(test.fetcher.mock.calls[1][1]?.method).toBe("PUT");
    expect(JSON.parse(test.fetcher.mock.calls[1][1]?.body as string)).toEqual({
      revision: 1,
      rounding: { lineAmount: "halfUp", taxAmount: "floor" },
    });
    expect(issuerForm.name).toBe("まだ保存しない発行者");
    expect(test.current.issuer.name).toBe("保存する発行者");
    expect(test.saveUpdatedIssuer).toHaveBeenCalledOnce();
    expect(savedSettings.rounding.lineAmount).toBe("floor");
  });
  it.each(["発行者", "端数処理"])(
    "%sのリビジョン競合時に自動再送・再読込せず、両方の入力を残す",
    async (section) => {
      const test = harness();
      const savedIssuer = createIssuer();
      const savedSettings = structuredClone(test.current.settings);
      const issuerForm = createIssuerForm(savedIssuer);
      const roundingForm = createRoundingForm(savedSettings);
      issuerForm.name = "未保存の氏名";
      roundingForm.taxAmount = "ceil";
      test.current.issuer.revision = 2;
      test.current.settings.revision = 2;
      const before = structuredClone({
        savedIssuer,
        savedSettings,
        issuerForm,
        roundingForm,
      });
      const result =
        section === "発行者"
          ? await saveIssuerForm(test.fetcher, savedIssuer, issuerForm)
          : await saveRoundingForm(test.fetcher, savedSettings, roundingForm);
      expect(result).toMatchObject({
        ok: false,
        error: { issues: [expect.objectContaining({ path: ["revision"] })] },
      });
      expect(test.fetcher).toHaveBeenCalledOnce();
      expect(test.saveUpdatedIssuer).not.toHaveBeenCalled();
      expect(test.saveSettings).not.toHaveBeenCalled();
      expect({ savedIssuer, savedSettings, issuerForm, roundingForm }).toEqual(
        before,
      );
    },
  );
  it.each(["電話番号", "振込先"])(
    "%sの削除は最新の取引先参照で拒否され、入力を残す",
    async (removed) => {
      const test = harness();
      const saved = createIssuer();
      const form = createIssuerForm(saved);
      test.current.partners = [
        createPartner({
          issuerDisplay: {
            phone: true,
            email: false,
            bankAccountIds: ["primary"],
          },
        }),
      ];
      if (removed === "電話番号") form.phone = "";
      else {
        form.bankAccounts.splice(0, 1);
        form.defaultBankAccountKey = 1;
      }
      const before = structuredClone(form);
      expect(await saveIssuerForm(test.fetcher, saved, form)).toMatchObject({
        ok: false,
        error: {
          issues: expect.arrayContaining([
            expect.objectContaining({
              message: expect.stringContaining("ACME"),
            }),
          ]),
        },
      });
      expect(test.fetcher).toHaveBeenCalledOnce();
      expect(test.saveUpdatedIssuer).not.toHaveBeenCalled();
      expect(form).toEqual(before);
    },
  );
  it("参照されていない振込先と任意の連絡先を全体保存で削除する", async () => {
    const test = harness();
    const form = createIssuerForm(test.current.issuer);
    form.phone = "";
    form.bankAccounts.splice(1, 1);
    expect(
      await saveIssuerForm(test.fetcher, test.current.issuer, form),
    ).toMatchObject({
      ok: true,
      value: {
        issuer: {
          phone: null,
          email: null,
          bankAccounts: [expect.objectContaining({ id: "primary" })],
        },
      },
    });
    expect(test.current.issuer.bankAccounts).toHaveLength(1);
  });
});
