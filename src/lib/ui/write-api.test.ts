import { describe, expect, it, vi } from "vitest";
import { writeJsonApi } from "./write-api";

describe("画面からのJSON書き込み", () => {
  it.each(["POST", "PUT", "DELETE"] as const)(
    "%s でJSONを1回送信する",
    async (method) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ revision: 2 }));
      expect(
        await writeJsonApi(fetcher, "/api/invoices/ACME-202610-01", method, {
          revision: 1,
        }),
      ).toEqual({ ok: true, value: { revision: 2 } });
      expect(fetcher).toHaveBeenCalledExactlyOnceWith(
        "/api/invoices/ACME-202610-01",
        {
          method,
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          cache: "no-store",
          body: '{"revision":1}',
        },
      );
    },
  );
  it("通信失敗時に再送や読み直しをせず、結果確認を促す", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    expect(
      await writeJsonApi(fetcher, "/api/invoices/ACME-202610-01", "PUT", {}),
    ).toMatchObject({
      ok: false,
      error: {
        message: expect.stringContaining("再送する前に最新データ"),
        issues: [],
      },
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("リビジョン競合を理由とともに返し、自動再送しない", async () => {
    const error = {
      message: "請求書を更新できません。",
      issues: [
        { path: ["revision"], message: "現在のリビジョンと一致しません。" },
      ],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(error, { status: 422 }));
    expect(
      await writeJsonApi(fetcher, "/api/invoices/ACME-202610-01", "PUT", {}),
    ).toEqual({ ok: false, error });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
