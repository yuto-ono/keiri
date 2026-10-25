import { describe, expect, it, vi } from "vitest";

import { readJsonApi } from "./read-api";

describe("画面からのJSON API読み取り", () => {
  it("キャッシュを使わずJSONを読み込み、毎回の読み取り結果を返す", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ value: "初回" }))
      .mockResolvedValueOnce(Response.json({ value: "更新後" }));
    expect(await readJsonApi(fetcher, "/api/dashboard")).toEqual({
      ok: true,
      value: { value: "初回" },
    });
    expect(await readJsonApi(fetcher, "/api/dashboard")).toEqual({
      ok: true,
      value: { value: "更新後" },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledWith("/api/dashboard", {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  });

  it("サーバーが返す対象パス・項目・位置とエラー理由を保持する", async () => {
    const issues = [
      {
        filePath: "issuers/issuer.yaml",
        path: ["bankAccounts", 0, "id"],
        line: 3,
        column: 2,
        message: "IDが不正です。",
      },
    ];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { message: "検証に失敗しました。", issues },
          { status: 500 },
        ),
      );
    expect(await readJsonApi(fetcher, "/api/settings")).toEqual({
      ok: false,
      error: { message: "検証に失敗しました。", issues },
    });
  });

  it("予期しないエラー形式でも表示に使えるデータだけを返す", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          message: { invalid: true },
          issues: [
            null,
            "invalid",
            { path: ["name"], message: "有効なエラー" },
            { path: [], message: "位置が不正", line: "3" },
          ],
        },
        { status: 500 },
      ),
    );
    expect(await readJsonApi(fetcher, "/api/settings")).toEqual({
      ok: false,
      error: {
        message: "データを読み込めませんでした（HTTP 500）。",
        issues: [{ path: ["name"], message: "有効なエラー" }],
      },
    });
  });

  it("通信失敗を画面に表示できるエラーとして返す", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await readJsonApi(fetcher, "/api/dashboard")).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("接続できません"), issues: [] },
    });
  });

  it.each([200, 500])(
    "JSONではないHTTP %d の応答を読み取りエラーにする",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("<html>エラー</html>", { status }));
      expect(await readJsonApi(fetcher, "/api/dashboard")).toMatchObject({
        ok: false,
        error: {
          message: expect.stringContaining("応答を読み取れません"),
          issues: [],
        },
      });
    },
  );
});
