import { describe, expect, it, vi } from "vitest";

import type { Invoice } from "#lib/domain/model";
import {
  createInvoiceForPartner,
  createPartner,
} from "#lib/testing/business-partners";
import { createReadData } from "#lib/testing/keiri-read-data";
import { getDashboard, type DashboardReadGateway } from "./read-dashboard";

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

function issued(
  paymentDueDate: string,
  overrides: Partial<Invoice> = {},
): Invoice {
  return {
    ...createInvoiceForPartner(
      createPartner({ addressee: "発行時の宛名", honorific: "様" }),
      "issued",
    ),
    paymentDueDate,
    ...overrides,
  };
}

describe("ダッシュボードのデータ取得", () => {
  it("年をまたぐ今月・先月だけを順に返し、記録なしと判定エラーを区別する", async () => {
    const harness = createHarness();
    harness.readMonthlyBilling.mockResolvedValueOnce({
      kind: "error",
      filePath: "monthly-billing/2026/01.md",
      body: "不正な記録",
      issues: [{ path: ["status"], message: "進捗が不正です。" }],
    });
    const result = await getDashboard(harness.gateway, "2026-01-01");
    expect(harness.readMonthlyBilling.mock.calls).toEqual([
      ["2026-01"],
      ["2025-12"],
    ]);
    expect(result.monthlyBilling).toEqual([
      {
        month: "2026-01",
        kind: "error",
        filePath: "monthly-billing/2026/01.md",
        body: "不正な記録",
        issues: [{ path: ["status"], message: "進捗が不正です。" }],
      },
      {
        month: "2025-12",
        kind: "missing",
        filePath: "monthly-billing/2025/12.md",
      },
    ]);
    expect(result.today).toBe("2026-01-01");
  });

  it("全年度の期限超過・未入金の発行済み請求書を期限の古い順に返す", async () => {
    const harness = createHarness();
    harness.data.invoices = [
      issued("2026-10-24", { invoiceNumber: "NEW" }),
      issued("2026-10-25", { invoiceNumber: "TODAY" }),
      issued("2026-10-26", { invoiceNumber: "FUTURE" }),
      issued("2025-12-31", {
        invoiceNumber: "PAID",
        paymentCompletedDate: "2026-01-01",
      }),
      issued("2025-12-31", {
        invoiceNumber: "DRAFT",
        status: "draft",
        pdf: { fileNameOverride: null, issuedFileName: null },
      }),
      issued("2025-12-31", {
        invoiceNumber: "OLD",
        invoiceDate: "2025-12-01",
      }),
    ];
    const before = structuredClone(harness.data);
    const result = await getDashboard(harness.gateway, "2026-10-25");
    expect(result.overdueInvoices).toEqual([
      {
        paymentDueDate: "2025-12-31",
        invoiceNumber: "OLD",
        addresseeWithHonorific: "発行時の宛名様",
        totalAmount: "11000",
      },
      {
        paymentDueDate: "2026-10-24",
        invoiceNumber: "NEW",
        addresseeWithHonorific: "発行時の宛名様",
        totalAmount: "11000",
      },
    ]);
    expect(harness.data).toEqual(before);
  });

  it("件数を制限せず、発行済み請求書の有無から月次進捗を推測しない", async () => {
    const harness = createHarness();
    harness.data.invoices = Array.from({ length: 101 }, (_, index) =>
      issued("2026-10-24", { invoiceNumber: `INVOICE-${index}` }),
    );
    harness.readMonthlyBilling.mockResolvedValueOnce({
      kind: "recorded",
      filePath: "monthly-billing/2026/10.md",
      status: "pending",
      body: "進行中",
    });
    harness.readMonthlyBilling.mockResolvedValueOnce({
      kind: "recorded",
      filePath: "monthly-billing/2026/09.md",
      status: "completed",
      body: "完了",
    });
    const result = await getDashboard(harness.gateway, "2026-10-25");
    expect(result.overdueInvoices).toHaveLength(101);
    expect(
      result.monthlyBilling.map((entry) =>
        entry.kind === "recorded" ? entry.status : entry.kind,
      ),
    ).toEqual(["pending", "completed"]);
  });

  it("必須データの検証が失敗した場合は通常の結果を返さない", async () => {
    const harness = createHarness();
    const error = new Error("必須データが不正です。");
    harness.loadData.mockRejectedValueOnce(error);
    await expect(getDashboard(harness.gateway, "2026-10-25")).rejects.toBe(
      error,
    );
    expect(harness.readMonthlyBilling).not.toHaveBeenCalled();
  });
});
