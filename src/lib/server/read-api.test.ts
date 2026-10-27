import { afterEach, describe, expect, it, vi } from "vitest";

import type { KeiriReadGateway } from "#lib/application/read-keiri-data";
import {
  createInvoiceForPartner,
  createPartner,
} from "#lib/testing/business-partners";
import { createReadData } from "#lib/testing/keiri-read-data";
import { KeiriDataLoadError } from "#lib/server/keiri-data-loader";
import {
  handleGetBusinessPartnerRequest,
  handleGetInvoicePdfRequest,
  handleGetInvoiceRequest,
  handleGetIssuerRequest,
  handleGetSettingsRequest,
  handleListBusinessPartnersRequest,
  handleListInvoicesRequest,
  handleListIssuersRequest,
  type ReadApiDependencies,
} from "./read-api";

function createHarness() {
  const data = createReadData();
  const loadData = vi.fn<KeiriReadGateway["loadData"]>(async () => data);
  const readIssuedPdf = vi.fn<KeiriReadGateway["readIssuedPdf"]>(
    async () => new Uint8Array([0, 255, 37, 42]),
  );
  return {
    data,
    loadData,
    readIssuedPdf,
    dependencies: { gateway: { loadData, readIssuedPdf }, today: "2026-10-25" },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

const readers: {
  name: string;
  run: (dependencies: ReadApiDependencies) => Promise<Response>;
  key: string;
}[] = [
  {
    name: "請求書一覧",
    run: (dependencies) =>
      handleListInvoicesRequest(
        new URL("http://127.0.0.1/api/invoices"),
        dependencies,
      ),
    key: "months",
  },
  {
    name: "請求書詳細",
    run: (dependencies) =>
      handleGetInvoiceRequest("ACME-202610-01", dependencies),
    key: "invoice",
  },
  {
    name: "取引先一覧",
    run: handleListBusinessPartnersRequest,
    key: "businessPartners",
  },
  {
    name: "取引先詳細",
    run: (dependencies) =>
      handleGetBusinessPartnerRequest("ACME", dependencies),
    key: "businessPartner",
  },
  { name: "発行者一覧", run: handleListIssuersRequest, key: "issuers" },
  {
    name: "発行者詳細",
    run: (dependencies) => handleGetIssuerRequest("issuer", dependencies),
    key: "issuer",
  },
  { name: "端数処理設定", run: handleGetSettingsRequest, key: "settings" },
];

describe("読み取りAPI", () => {
  it.each(readers)(
    "$name をJSONで取得でき、キャッシュを残さない",
    async ({ run, key }) => {
      const harness = createHarness();
      const response = await run(harness.dependencies);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(await response.json()).toHaveProperty(key);
      expect(harness.loadData).toHaveBeenCalledOnce();
    },
  );

  it("指定された請求年と東京基準の現在年を一覧へ渡す", async () => {
    const harness = createHarness();
    harness.data.invoices = [
      { ...createInvoiceForPartner(), invoiceDate: "2025-12-31" },
    ];
    const defaultResponse = await handleListInvoicesRequest(
      new URL("http://127.0.0.1/api/invoices"),
      { ...harness.dependencies, today: "2026-01-01" },
    );
    await expect(defaultResponse.json()).resolves.toMatchObject({
      year: "2026",
      months: [],
    });
    const previousResponse = await handleListInvoicesRequest(
      new URL("http://127.0.0.1/api/invoices?year=2025"),
      harness.dependencies,
    );
    await expect(previousResponse.json()).resolves.toMatchObject({
      year: "2025",
      months: [{ month: "2025-12" }],
    });
  });

  it.each([
    "year=",
    "year=2026-01",
    "year=20260",
    "year=../2026",
    "year=2026&year=2025",
  ])("不正・重複した請求年 %s を読み込み前に400で拒否する", async (query) => {
    const harness = createHarness();
    const response = await handleListInvoicesRequest(
      new URL(`http://127.0.0.1/api/invoices?${query}`),
      harness.dependencies,
    );
    expect(response.status).toBe(400);
    expect(harness.loadData).not.toHaveBeenCalled();
  });

  it("大きな請求合計をJSONでも文字列のまま正確に返す", async () => {
    const harness = createHarness();
    const invoice = createInvoiceForPartner();
    invoice.lineItems[0] = {
      ...invoice.lineItems[0],
      quantity: 999_999_999_999.99,
      unitPrice: 999_999_999_999,
    };
    harness.data.invoices = [invoice];
    const response = await handleGetInvoiceRequest(
      invoice.invoiceNumber,
      harness.dependencies,
    );
    await expect(response.json()).resolves.toMatchObject({
      calculation: { totalAmount: "1099999999998889000000000" },
    });
  });

  it("存在しない請求書・取引先・発行者と下書きPDFを404で返す", async () => {
    const harness = createHarness();
    const responses = await Promise.all([
      handleGetInvoiceRequest("MISSING", harness.dependencies),
      handleGetBusinessPartnerRequest("MISSING", harness.dependencies),
      handleGetIssuerRequest("MISSING", harness.dependencies),
      handleGetInvoicePdfRequest("ACME-202610-01", harness.dependencies),
      handleGetInvoicePdfRequest("MISSING", harness.dependencies),
    ]);
    expect(responses.map((response) => response.status)).toEqual([
      404, 404, 404, 404, 404,
    ]);
    expect(harness.readIssuedPdf).not.toHaveBeenCalled();
  });

  it("記録済みPDFをバイナリのままインライン配信し、日本語・記号をヘッダーへエンコードする", async () => {
    const harness = createHarness();
    const invoice = createInvoiceForPartner(createPartner(), "issued");
    const fileName = "日本語の請求書 '特別'(1).pdf";
    invoice.pdf.issuedFileName = fileName;
    harness.data.invoices = [invoice];
    const response = await handleGetInvoicePdfRequest(
      invoice.invoiceNumber,
      harness.dependencies,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const disposition = response.headers.get("content-disposition")!;
    expect(disposition).toMatch(/^inline; filename\*=UTF-8''/);
    expect(disposition).toContain("%27");
    expect(disposition).toContain("%28");
    expect(decodeURIComponent(disposition.split("''")[1])).toBe(fileName);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([0, 255, 37, 42]),
    );
  });

  it.each(["JSON", "PDF"])(
    "%s のデータ検証失敗を対象パスと理由付きの500で返す",
    async (kind) => {
      const harness = createHarness();
      const issues = [
        {
          filePath: "issuers/issuer.yaml",
          path: ["name"],
          message: "氏名がありません。",
        },
      ];
      harness.loadData.mockRejectedValueOnce(new KeiriDataLoadError(issues));
      const response =
        kind === "JSON"
          ? await handleGetSettingsRequest(harness.dependencies)
          : await handleGetInvoicePdfRequest(
              "ACME-202610-01",
              harness.dependencies,
            );
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({ issues });
      expect(harness.readIssuedPdf).not.toHaveBeenCalled();
    },
  );

  it("設定の不足をJSONで返し、通常のデータを返さない", async () => {
    vi.stubEnv("KEIRI_DATA_DIR", "");
    const response = await handleGetSettingsRequest();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      message: expect.stringContaining("KEIRI_DATA_DIR"),
    });
  });
});
