import { describe, expect, it, vi } from "vitest";
import {
  createIssuer,
  createPartner,
  createInvoiceForPartner,
} from "#lib/testing/business-partners";
import {
  handleCreateBusinessPartnerRequest,
  handleUpdateBusinessPartnerRequest,
  handleDeleteBusinessPartnerRequest,
} from "#lib/server/business-partner-api";
import type { BusinessPartnerManagementGateway } from "#lib/application/manage-business-partners";
import {
  createBusinessPartnerForm,
  deleteSavedBusinessPartner,
  moveBusinessPartnerBank,
  prepareBusinessPartnerForm,
  saveBusinessPartnerForm,
  selectBusinessPartnerBank,
} from "./business-partner-editor";

function gateway(): BusinessPartnerManagementGateway {
  return {
    loadManagementContext: async () => ({
      businessPartners: [createPartner()],
      issuers: [createIssuer()],
      invoices: [],
    }),
    saveNewBusinessPartner: vi.fn(async () => ({ filePath: "new.yaml" })),
    saveUpdatedBusinessPartner: vi.fn(async () => ({
      filePath: "updated.yaml",
    })),
    deleteBusinessPartner: vi.fn(async () => ({ filePath: "deleted.yaml" })),
  };
}
function apiFetcher(storage: BusinessPartnerManagementGateway) {
  return vi.fn<typeof fetch>(async (path, init) => {
    const url = new URL(String(path), "http://127.0.0.1");
    const request = new Request(url, {
      ...init,
      headers: { ...init?.headers, origin: url.origin },
    });
    const dependencies = { gateway: storage };
    if (init?.method === "POST")
      return handleCreateBusinessPartnerRequest(request, url, dependencies);
    const code = decodeURIComponent(url.pathname.split("/").at(-1)!);
    return init?.method === "PUT"
      ? handleUpdateBusinessPartnerRequest(request, url, code, dependencies)
      : handleDeleteBusinessPartnerRequest(request, url, code, dependencies);
  });
}

describe("取引先フォーム", () => {
  it("新規登録では発行者の現在値から連絡先・既定の振込先を初期選択し、未保存にする", () => {
    const issuer = createIssuer();
    issuer.defaultBankAccountId = "secondary";
    const form = createBusinessPartnerForm(null, issuer);
    expect(form).toMatchObject({
      code: "",
      addressee: "",
      honorific: "",
      requiresMonthlyInvoice: "",
      unitPricesIncludeTax: "",
      showPhone: true,
      showEmail: false,
      bankAccountIds: ["secondary"],
      billingInstructions: "",
      pdfFileNamePattern: "{businessPartnerCode}-{issueDate:YYYYMM}-{sequence}",
    });
    expect(form).not.toHaveProperty("revision");
    expect(
      createBusinessPartnerForm(null, {
        ...issuer,
        phone: null,
        email: "test@example.com",
      }),
    ).toMatchObject({ showPhone: false, showEmail: true });
  });
  it("保存済みの表示設定と振込先の順序を維持し、現在の既定値へ置き換えない", () => {
    const partner = createPartner({
      issuerDisplay: {
        phone: false,
        email: false,
        bankAccountIds: ["secondary", "primary"],
      },
      billingInstructions: "契約の確認\n\n月末に請求",
    });
    const form = createBusinessPartnerForm(partner, createIssuer());
    expect(form).toMatchObject({
      showPhone: false,
      bankAccountIds: ["secondary", "primary"],
      billingInstructions: partner.billingInstructions,
    });
    form.bankAccountIds.reverse();
    expect(partner.issuerDisplay.bankAccountIds).toEqual([
      "secondary",
      "primary",
    ]);
  });
  it("振込先の並べ替え後に選択を変えても、残りの表示順を維持する", () => {
    const original = ["primary", "secondary", "third"];
    const moved = moveBusinessPartnerBank(original, 1, -1);
    expect(moved).toEqual(["secondary", "primary", "third"]);
    const removed = selectBusinessPartnerBank(moved, "primary", false);
    expect(removed).toEqual(["secondary", "third"]);
    expect(selectBusinessPartnerBank(removed, "primary", true)).toEqual([
      "secondary",
      "third",
      "primary",
    ]);
    expect(selectBusinessPartnerBank(removed, "secondary", true)).toEqual(
      removed,
    );
    expect(moveBusinessPartnerBank(moved, 0, -1)).toEqual(moved);
    expect(original).toEqual(["primary", "secondary", "third"]);
  });
  it("空欄の請求指示だけをnullにし、本文の空行・前後の空白は変更しない", () => {
    const issuer = createIssuer();
    const form = createBusinessPartnerForm(createPartner(), issuer);
    expect(prepareBusinessPartnerForm(form, issuer)).toMatchObject({
      ok: true,
      value: { billingInstructions: null },
    });
    form.billingInstructions = " 契約内容\n\n請求方法 ";
    expect(prepareBusinessPartnerForm(form, issuer)).toMatchObject({
      ok: true,
      value: { billingInstructions: form.billingInstructions },
    });
  });
  it("必須選択の未入力を保持して送信しない", async () => {
    const issuer = createIssuer();
    const form = createBusinessPartnerForm(null, issuer);
    const before = structuredClone(form);
    const fetcher = vi.fn<typeof fetch>();
    expect(
      await saveBusinessPartnerForm(fetcher, null, form, issuer),
    ).toMatchObject({
      ok: false,
      error: {
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ["honorific"] }),
          expect.objectContaining({ path: ["requiresMonthlyInvoice"] }),
          expect.objectContaining({ path: ["unitPricesIncludeTax"] }),
        ]),
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(form).toEqual(before);
  });
  it("振込先0件・表示できない連絡先・不正な命名規則をdomainの規則で拒否する", async () => {
    const issuer = createIssuer();
    const form = createBusinessPartnerForm(createPartner(), issuer);
    form.bankAccountIds = [];
    form.showEmail = true;
    form.pdfFileNamePattern = "{unknown}";
    const fetcher = vi.fn<typeof fetch>();
    expect(
      await saveBusinessPartnerForm(fetcher, null, form, issuer),
    ).toMatchObject({
      ok: false,
      error: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: ["issuerDisplay", "bankAccountIds"],
          }),
          expect.objectContaining({ path: ["issuerDisplay", "email"] }),
          expect.objectContaining({ path: ["pdfFileNamePattern"] }),
        ]),
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("新規登録は全体を1回送信し、サーバーがrevision 1で作成する", async () => {
    const issuer = createIssuer();
    const form = createBusinessPartnerForm(
      createPartner({ code: "NEW" }),
      issuer,
    );
    form.showPhone = true;
    form.bankAccountIds = ["secondary", "primary"];
    form.billingInstructions = "毎月請求\n\n内容を確認";
    const storage = gateway();
    const fetcher = apiFetcher(storage);
    const before = structuredClone(form);
    expect(
      await saveBusinessPartnerForm(fetcher, null, form, issuer),
    ).toMatchObject({
      ok: true,
      value: {
        businessPartner: {
          code: "NEW",
          revision: 1,
          billingInstructions: form.billingInstructions,
          issuerDisplay: {
            phone: true,
            bankAccountIds: ["secondary", "primary"],
          },
        },
      },
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]?.method).toBe("POST");
    expect(
      JSON.parse(fetcher.mock.calls[0][1]?.body as string),
    ).not.toHaveProperty("revision");
    expect(storage.saveNewBusinessPartner).toHaveBeenCalledOnce();
    expect(form).toEqual(before);
  });
  it("未参照のコード変更を元のコードのAPIへ送り、保存済みリビジョンを使用する", async () => {
    const saved = createPartner();
    const form = createBusinessPartnerForm(saved, createIssuer());
    form.code = "RENAMED";
    form.addressee = "変更後の宛名";
    const storage = gateway();
    const fetcher = apiFetcher(storage);
    expect(
      await saveBusinessPartnerForm(fetcher, saved, form, createIssuer()),
    ).toMatchObject({
      ok: true,
      value: { businessPartner: { code: "RENAMED", revision: 2 } },
    });
    expect(fetcher.mock.calls[0][0]).toBe("/api/business-partners/ACME");
    expect(fetcher.mock.calls[0][1]?.method).toBe("PUT");
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toMatchObject({
      revision: 1,
      code: "RENAMED",
      addressee: "変更後の宛名",
    });
    expect(saved).toEqual(createPartner());
  });
  it.each(["revision", "reference"])(
    "保存中に変わった%sをサーバーで拒否し、入力を維持して再送・再読込しない",
    async (change) => {
      const saved = createPartner();
      const form = createBusinessPartnerForm(saved, createIssuer());
      form.code = "RENAMED";
      form.billingInstructions = "未保存の指示";
      const before = structuredClone({ saved, form });
      const storage = gateway();
      storage.loadManagementContext = async () => ({
        businessPartners: [
          { ...saved, revision: change === "revision" ? 2 : 1 },
        ],
        issuers: [createIssuer()],
        invoices:
          change === "reference" ? [createInvoiceForPartner(saved)] : [],
      });
      const fetcher = apiFetcher(storage);
      expect(
        (await saveBusinessPartnerForm(fetcher, saved, form, createIssuer()))
          .ok,
      ).toBe(false);
      expect({ saved, form }).toEqual(before);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(storage.saveUpdatedBusinessPartner).not.toHaveBeenCalled();
    },
  );
  it("削除は入力中のコードではなく保存済みコードとリビジョンを使用する", async () => {
    const saved = createPartner();
    const storage = gateway();
    const fetcher = apiFetcher(storage);
    expect(await deleteSavedBusinessPartner(fetcher, saved)).toMatchObject({
      ok: true,
      value: { code: "ACME" },
    });
    expect(fetcher.mock.calls[0][0]).toBe("/api/business-partners/ACME");
    expect(fetcher.mock.calls[0][1]?.method).toBe("DELETE");
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({
      revision: 1,
    });
    expect(storage.deleteBusinessPartner).toHaveBeenCalledOnce();
  });
  it("削除直前に請求書から参照された場合もサーバーで拒否する", async () => {
    const storage = gateway();
    storage.loadManagementContext = async () => ({
      businessPartners: [createPartner()],
      issuers: [createIssuer()],
      invoices: [createInvoiceForPartner()],
    });
    expect(
      (await deleteSavedBusinessPartner(apiFetcher(storage), createPartner()))
        .ok,
    ).toBe(false);
    expect(storage.deleteBusinessPartner).not.toHaveBeenCalled();
  });
});
