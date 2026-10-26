import { describe, expect, it, vi } from "vitest";
import { load as loadNew } from "../../routes/invoices/new/+page";
import { load as loadDuplicate } from "../../routes/invoices/[invoiceNumber]/duplicate/+page";

describe("新規作成・複製画面の読み込み", () => {
  it("新規作成画面を開くと読み取りだけを行う", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ source: null }));
    const result = await loadNew({
      fetch: fetcher,
      parent: async () => ({ startupError: null }),
    } as unknown as Parameters<typeof loadNew>[0]);
    expect(result.creation).toMatchObject({
      ok: true,
      value: { source: null },
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe("/api/invoices/new");
    expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
  });
  it("複製画面を開くだけでは複製のPOSTを行わない", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ source: { invoiceNumber: "ACME-202610-01" } }),
      );
    const result = await loadDuplicate({
      fetch: fetcher,
      parent: async () => ({ startupError: null }),
      params: { invoiceNumber: "ACME-202610-01" },
    } as unknown as Parameters<typeof loadDuplicate>[0]);
    expect(result.creation?.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(
      "/api/invoices/ACME-202610-01/duplicate",
    );
    expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
  });
  it("起動エラーがあれば準備データも取得しない", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const parent = async () => ({
      startupError: { message: "不正です。", issues: [] },
    });
    expect(
      await loadNew({ fetch: fetcher, parent } as unknown as Parameters<
        typeof loadNew
      >[0]),
    ).toEqual({ creation: null });
    expect(
      await loadDuplicate({ fetch: fetcher, parent } as unknown as Parameters<
        typeof loadDuplicate
      >[0]),
    ).toEqual({ creation: null });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
