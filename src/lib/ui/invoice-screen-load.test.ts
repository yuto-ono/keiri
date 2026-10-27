import { describe, expect, it, vi } from "vitest";
import { load as loadList } from "../../routes/invoices/+page";
import { load as loadDetail } from "../../routes/invoices/[invoiceNumber]/+page";

describe("請求書画面の読み込み", () => {
  it("一覧は年未指定をAPIへ渡し、東京基準の現在年の決定を共通処理に任せる", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ year: "2026", years: ["2026"], months: [] }),
      );
    const result = await loadList({
      data: null,
      fetch: fetcher,
      parent: async () => ({ startupError: null }),
      url: new URL("http://127.0.0.1/invoices"),
    } as unknown as Parameters<typeof loadList>[0]);
    expect(result.invoices).toMatchObject({
      ok: true,
      value: { year: "2026" },
    });
    expect(fetcher.mock.calls[0][0]).toBe("/api/invoices");
  });
  it("指定した請求年と不正・重複した値をAPIへそのまま渡す", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { message: "不正な請求年です。", issues: [] },
          { status: 400 },
        ),
      );
    const result = await loadList({
      data: null,
      fetch: fetcher,
      parent: async () => ({ startupError: null }),
      url: new URL("http://127.0.0.1/invoices?year=2025&year=2026"),
    } as unknown as Parameters<typeof loadList>[0]);
    expect(result.invoices?.ok).toBe(false);
    expect(fetcher.mock.calls[0][0]).toBe("/api/invoices?year=2025&year=2026");
  });
  it("詳細は請求書番号のパスで取得する", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ invoice: { invoiceNumber: "ACME-202610-01" } }),
      );
    const result = await loadDetail({
      data: null,
      fetch: fetcher,
      parent: async () => ({ startupError: null }),
      params: { invoiceNumber: "ACME-202610-01" },
    } as unknown as Parameters<typeof loadDetail>[0]);
    expect(result.detail?.ok).toBe(true);
    expect(fetcher.mock.calls[0][0]).toBe("/api/invoices/ACME-202610-01");
  });
  it("必須データの起動エラー時は一覧と詳細を取得しない", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const parent = async () => ({
      startupError: { message: "不正です。", issues: [] },
    });
    expect(
      await loadList({
        data: null,
        fetch: fetcher,
        parent,
      } as unknown as Parameters<typeof loadList>[0]),
    ).toEqual({ invoices: null });
    expect(
      await loadDetail({
        data: null,
        fetch: fetcher,
        parent,
      } as unknown as Parameters<typeof loadDetail>[0]),
    ).toEqual({ detail: null });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
