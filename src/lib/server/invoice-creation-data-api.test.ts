import { afterEach, describe, expect, it, vi } from "vitest";
import { handleGetInvoiceCreationDataRequest } from "./read-api";
import { KeiriDataLoadError } from "./keiri-data-loader";
import { createReadData } from "#lib/testing/keiri-read-data";

afterEach(() => vi.useRealTimers());

describe("作成フォームの読み取りAPI", () => {
  it.each([undefined, "ACME-202610-01"])(
    "%s の準備データをJSONで返し、キャッシュしない",
    async (source) => {
      const data = createReadData();
      const readIssuedPdf = vi.fn();
      const response = await handleGetInvoiceCreationDataRequest(source, {
        gateway: { loadData: async () => data, readIssuedPdf },
        today: "2026-01-01",
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.json();
      expect(body.today).toBe("2026-01-01");
      expect(body).not.toHaveProperty("revision");
      expect(body).not.toHaveProperty("invoiceNumber");
      expect(body.source?.invoiceNumber ?? null).toBe(source ?? null);
      expect(readIssuedPdf).not.toHaveBeenCalled();
    },
  );
  it("初期日付は東京の年明けを基準にする", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-12-31T15:00:00.000Z"));
    const response = await handleGetInvoiceCreationDataRequest(undefined, {
      gateway: {
        loadData: async () => createReadData(),
        readIssuedPdf: vi.fn(),
      },
    });
    await expect(response.json()).resolves.toHaveProperty(
      "today",
      "2026-01-01",
    );
  });
  it("存在しない複製元を404で返す", async () => {
    const response = await handleGetInvoiceCreationDataRequest("MISSING", {
      gateway: {
        loadData: async () => createReadData(),
        readIssuedPdf: vi.fn(),
      },
    });
    expect(response.status).toBe(404);
  });
  it("必須データが不正なら500と対象パスを返す", async () => {
    const issues = [
      { filePath: "settings.yaml", path: ["rounding"], message: "不正です。" },
    ];
    const response = await handleGetInvoiceCreationDataRequest(undefined, {
      gateway: {
        loadData: async () => {
          throw new KeiriDataLoadError(issues);
        },
        readIssuedPdf: vi.fn(),
      },
    });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ issues });
  });
});
