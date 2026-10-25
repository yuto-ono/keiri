import { afterEach, describe, expect, it, vi } from "vitest";

import type { DashboardReadGateway } from "#lib/application/read-dashboard";
import {
  createInvoiceForPartner,
  createPartner,
} from "#lib/testing/business-partners";
import { createReadData } from "#lib/testing/keiri-read-data";
import { KeiriDataLoadError } from "./keiri-data-loader";
import { handleGetDashboardRequest } from "./read-api";

function createHarness() {
  const data = createReadData();
  const loadData = vi.fn<DashboardReadGateway["loadData"]>(async () => data);
  const readMonthlyBilling = vi.fn<DashboardReadGateway["readMonthlyBilling"]>(
    async (month) => ({
      kind: "missing",
      filePath: `monthly-billing/${month.replace("-", "/")}.md`,
    }),
  );
  return {
    data,
    loadData,
    readMonthlyBilling,
    gateway: { loadData, readMonthlyBilling },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("ダッシュボード読み取りAPI", () => {
  it("個別の判定エラーも通常の応答に含め、要対応の請求書をJSONで返す", async () => {
    const harness = createHarness();
    harness.data.invoices = [
      {
        ...createInvoiceForPartner(createPartner(), "issued"),
        paymentDueDate: "2026-10-24",
      },
    ];
    harness.readMonthlyBilling.mockResolvedValueOnce({
      kind: "error",
      filePath: "monthly-billing/2026/10.md",
      body: "<b>そのまま表示する本文</b>",
      issues: [
        { path: ["status"], message: "進捗が不正です。", line: 2, column: 1 },
      ],
    });
    const response = await handleGetDashboardRequest({
      gateway: harness.gateway,
      today: "2026-10-25",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      today: "2026-10-25",
      monthlyBilling: [
        {
          month: "2026-10",
          kind: "error",
          body: "<b>そのまま表示する本文</b>",
          filePath: "monthly-billing/2026/10.md",
          issues: [
            {
              path: ["status"],
              message: "進捗が不正です。",
              line: 2,
              column: 1,
            },
          ],
        },
        { month: "2026-09", kind: "missing" },
      ],
      overdueInvoices: [
        { invoiceNumber: "ACME-202610-01", totalAmount: "11000" },
      ],
    });
  });

  it("東京の年明けに今月と先月を切り替える", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-12-31T15:00:00.000Z"));
    const harness = createHarness();
    const response = await handleGetDashboardRequest({
      gateway: harness.gateway,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      today: "2026-01-01",
    });
    expect(harness.readMonthlyBilling.mock.calls).toEqual([
      ["2026-01"],
      ["2025-12"],
    ]);
  });

  it("必須データの不正は対象パスと理由付きの500で返す", async () => {
    const harness = createHarness();
    const issues = [
      {
        filePath: "settings.yaml",
        path: ["rounding"],
        message: "設定が不正です。",
      },
    ];
    harness.loadData.mockRejectedValueOnce(new KeiriDataLoadError(issues));
    const response = await handleGetDashboardRequest({
      gateway: harness.gateway,
      today: "2026-10-25",
    });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ issues });
    expect(harness.readMonthlyBilling).not.toHaveBeenCalled();
  });

  it("環境設定が不足している場合は500で返す", async () => {
    vi.stubEnv("KEIRI_DATA_DIR", "");
    const response = await handleGetDashboardRequest();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      message: expect.stringContaining("KEIRI_DATA_DIR"),
    });
  });
});
