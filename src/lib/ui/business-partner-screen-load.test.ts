import { describe, expect, it, vi } from "vitest";
import { createIssuer, createPartner } from "#lib/testing/business-partners";
import { loadBusinessPartnerEditor } from "./business-partner-editor";
import { load as loadList } from "../../routes/business-partners/+page";
import { load as loadNew } from "../../routes/business-partners/new-partner/+page";
import { load as loadDetail } from "../../routes/business-partners/[code]/+page";

function fetcher() {
  return vi.fn<typeof fetch>(async (path) =>
    String(path) === "/api/issuers"
      ? Response.json({ issuers: [createIssuer()] })
      : Response.json({
          businessPartner: createPartner(),
          hasInvoiceReferences: true,
        }),
  );
}
describe("取引先画面の読み込み", () => {
  it("一覧は全件APIを呼び、検索・並べ替え・ページ指定を付けない", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ businessPartners: [] }));
    const result = await loadList({
      fetch,
      parent: async () => ({ startupError: null }),
    } as unknown as Parameters<typeof loadList>[0]);
    expect(result.partners).toEqual({
      ok: true,
      value: { businessPartners: [] },
    });
    expect(fetch.mock.calls[0][0]).toBe("/api/business-partners");
  });
  it("新規登録では発行者だけを読み、取引先を作成しない", async () => {
    const fetch = fetcher();
    const result = await loadNew({
      fetch,
      parent: async () => ({ startupError: null }),
    } as unknown as Parameters<typeof loadNew>[0]);
    expect(result.editor).toEqual({
      ok: true,
      value: {
        businessPartner: null,
        hasInvoiceReferences: false,
        issuer: createIssuer(),
      },
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe("/api/issuers");
  });
  it("詳細は保存済み取引先・参照状態・現在の発行者を読み取る", async () => {
    const fetch = fetcher();
    const result = await loadDetail({
      fetch,
      parent: async () => ({ startupError: null }),
      params: { code: "ACME" },
    } as unknown as Parameters<typeof loadDetail>[0]);
    expect(result.editor).toEqual({
      ok: true,
      value: {
        businessPartner: createPartner(),
        hasInvoiceReferences: true,
        issuer: createIssuer(),
      },
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/issuers",
      "/api/business-partners/ACME",
    ]);
  });
  it.each(["/api/issuers", "/api/business-partners/ACME"])(
    "%sの失敗時は部分データで編集させない",
    async (failedPath) => {
      const success = fetcher();
      const fetch = vi.fn<typeof globalThis.fetch>(async (path, init) =>
        String(path) === failedPath
          ? Response.json(
              { message: "読み込めません。", issues: [] },
              { status: 500 },
            )
          : success(path, init),
      );
      expect(await loadBusinessPartnerEditor(fetch, "ACME")).toEqual({
        ok: false,
        error: { message: "読み込めません。", issues: [] },
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );
  it("発行者が1件でない場合に暗黙に選ばない", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ issuers: [] }));
    expect((await loadBusinessPartnerEditor(fetch)).ok).toBe(false);
  });
  it("起動時の検証に失敗していれば各画面のAPIを呼ばない", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const event = {
      fetch,
      parent: async () => ({
        startupError: { message: "不正です。", issues: [] },
      }),
    };
    expect(
      await loadList(event as unknown as Parameters<typeof loadList>[0]),
    ).toEqual({ partners: null });
    expect(
      await loadNew(event as unknown as Parameters<typeof loadNew>[0]),
    ).toEqual({ editor: null });
    expect(
      await loadDetail(event as unknown as Parameters<typeof loadDetail>[0]),
    ).toEqual({ editor: null });
    expect(fetch).not.toHaveBeenCalled();
  });
});
