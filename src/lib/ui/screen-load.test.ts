import { describe, expect, it, vi } from "vitest";

import { load as loadLayout } from "../../routes/+layout";
import { load as loadPage } from "../../routes/+page";

function layoutEvent(fetcher: typeof fetch) {
  return { fetch: fetcher } as Parameters<typeof loadLayout>[0];
}

function pageEvent(
  fetcher: typeof fetch,
  layoutData: Awaited<ReturnType<typeof loadLayout>>,
) {
  return { fetch: fetcher, parent: async () => layoutData } as Parameters<
    typeof loadPage
  >[0];
}

describe("画面読み込みのデータ検証", () => {
  it("必須データが不正なら起動エラーを返し、ダッシュボードを読み込まない", async () => {
    const error = {
      message: "keiri-dataの検証に失敗しました。",
      issues: [
        {
          filePath: "settings.yaml",
          path: ["rounding"],
          message: "設定が不正です。",
        },
      ],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(error, { status: 500 }));
    const layout = await loadLayout(layoutEvent(fetcher));
    expect(layout.startupError).toEqual(error);
    expect(await loadPage(pageEvent(fetcher, layout))).toEqual({
      dashboard: null,
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/settings"]);
  });

  it("月次記録の判定エラーは起動を妨げず、本文をそのままダッシュボードへ渡す", async () => {
    const dashboard = {
      today: "2026-10-26",
      monthlyBilling: [
        {
          month: "2026-10",
          filePath: "monthly-billing/2026/10.md",
          kind: "error",
          body: "# 本文\n<script>window.alert('実行しない')</script>\n",
          issues: [{ path: ["status"], message: "値が不正です。" }],
        },
        {
          month: "2026-09",
          filePath: "monthly-billing/2026/09.md",
          kind: "missing",
        },
      ],
      overdueInvoices: [
        {
          invoiceNumber: "ACME-202610-01",
          paymentDueDate: "2026-10-25",
          addresseeWithHonorific: "株式会社サンプル御中",
          totalAmount: "9007199254740993",
        },
      ],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ settings: {} }))
      .mockResolvedValueOnce(Response.json(dashboard));
    const layout = await loadLayout(layoutEvent(fetcher));
    expect(layout.startupError).toBeNull();
    expect(await loadPage(pageEvent(fetcher, layout))).toEqual({
      dashboard: { ok: true, value: dashboard },
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/settings",
      "/api/dashboard",
    ]);
  });

  it("起動検証後のダッシュボード読み取り失敗をエラーとして返す", async () => {
    const error = {
      message: "keiri-dataの検証に失敗しました。",
      issues: [
        {
          filePath: "sales/invoices/2026/ACME-202610-01.yaml",
          path: ["pdf", "issuedFileName"],
          message: "正式PDFがありません。",
        },
      ],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(error, { status: 500 }));
    expect(await loadPage(pageEvent(fetcher, { startupError: null }))).toEqual({
      dashboard: { ok: false, error },
    });
  });

  it("エラーの修正後、明示的な再読み込みで検証し直せる", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { message: "設定が不正です。", issues: [] },
          { status: 500 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ settings: {} }))
      .mockResolvedValueOnce(
        Response.json({
          today: "2026-10-26",
          monthlyBilling: [],
          overdueInvoices: [],
        }),
      );
    expect(
      (await loadLayout(layoutEvent(fetcher))).startupError,
    ).not.toBeNull();
    const reloaded = await loadLayout(layoutEvent(fetcher));
    expect(reloaded.startupError).toBeNull();
    expect((await loadPage(pageEvent(fetcher, reloaded))).dashboard?.ok).toBe(
      true,
    );
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/settings",
      "/api/settings",
      "/api/dashboard",
    ]);
  });
});
