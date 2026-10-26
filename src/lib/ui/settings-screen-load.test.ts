import { describe, expect, it, vi } from "vitest";
import { createIssuer } from "#lib/testing/business-partners";
import { loadSettingsScreen } from "./settings-editor";
import { load } from "../../routes/settings/+page";

const settings = {
  revision: 1,
  rounding: { lineAmount: "floor", taxAmount: "floor" },
};
function successfulResponse(path: string) {
  return path === "/api/issuers" ? { issuers: [createIssuer()] } : { settings };
}
describe("設定画面の読み込み", () => {
  it("発行者と端数処理を読み込む", async () => {
    const fetcher = vi.fn<typeof fetch>(async (path) =>
      Response.json(successfulResponse(String(path))),
    );
    expect(
      await load({
        fetch: fetcher,
        parent: async () => ({ startupError: null }),
      } as unknown as Parameters<typeof load>[0]),
    ).toEqual({
      settingsScreen: { ok: true, value: { issuer: createIssuer(), settings } },
    });
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      "/api/issuers",
      "/api/settings",
    ]);
    expect(
      fetcher.mock.calls.every(([, init]) => init?.cache === "no-store"),
    ).toBe(true);
  });
  it.each(["/api/issuers", "/api/settings"])(
    "%sが失敗したら部分データで画面を表示しない",
    async (failedPath) => {
      const fetcher = vi.fn<typeof fetch>(async (path) =>
        String(path) === failedPath
          ? Response.json(
              { message: "読み込めません。", issues: [] },
              { status: 500 },
            )
          : Response.json(successfulResponse(String(path))),
      );
      expect(await loadSettingsScreen(fetcher)).toEqual({
        ok: false,
        error: { message: "読み込めません。", issues: [] },
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it.each([
    { issuers: [] },
    { issuers: [createIssuer(), { ...createIssuer(), id: "other" }] },
  ])("発行者が1件でない場合に暗黙に選ばない", async ({ issuers }) => {
    const fetcher = vi.fn<typeof fetch>(async (path) =>
      Response.json(
        String(path) === "/api/issuers" ? { issuers } : { settings },
      ),
    );
    expect((await loadSettingsScreen(fetcher)).ok).toBe(false);
  });
  it("起動時の検証に失敗していれば設定画面のAPIを呼ばない", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(
      await load({
        fetch: fetcher,
        parent: async () => ({
          startupError: { message: "不正です。", issues: [] },
        }),
      } as unknown as Parameters<typeof load>[0]),
    ).toEqual({ settingsScreen: null });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
