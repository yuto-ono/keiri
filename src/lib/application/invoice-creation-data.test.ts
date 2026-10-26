import { describe, expect, it, vi } from "vitest";
import {
  getInvoiceCreationData,
  type KeiriReadGateway,
} from "./read-keiri-data";
import { createReadData } from "#lib/testing/keiri-read-data";
import {
  createInvoiceForPartner,
  createPartner,
} from "#lib/testing/business-partners";

function harness() {
  const data = createReadData();
  const readIssuedPdf = vi.fn<KeiriReadGateway["readIssuedPdf"]>();
  return {
    data,
    readIssuedPdf,
    gateway: { loadData: async () => data, readIssuedPdf },
  };
}

describe("未保存請求書の画面データ", () => {
  it("取引先をコード順に返し、採番枠がなくても準備段階では採番しない", async () => {
    const { data, gateway, readIssuedPdf } = harness();
    data.businessPartners = [createPartner({ code: "Z" }), createPartner()];
    data.invoices = [{ ...data.invoices[0], invoiceNumber: "ACME-202610-99" }];
    const before = structuredClone(data);
    const result = await getInvoiceCreationData(gateway);
    expect(result).toMatchObject({
      source: null,
      issuer: data.issuers[0],
      rounding: data.settings.rounding,
      taxCategory: { id: "standard-10" },
    });
    expect(result?.businessPartners.map((partner) => partner.code)).toEqual([
      "ACME",
      "Z",
    ]);
    expect(result).not.toHaveProperty("invoiceNumber");
    expect(result).not.toHaveProperty("revision");
    expect(data).toEqual(before);
    expect(readIssuedPdf).not.toHaveBeenCalled();
  });
  it.each(["draft", "issued"] as const)(
    "%s の複製で明細・備考と参照元だけを返し、ライフサイクル情報を引き継がない",
    async (status) => {
      const { data, gateway, readIssuedPdf } = harness();
      const source = createInvoiceForPartner(createPartner(), status);
      source.notes = "引き継ぐ備考";
      source.pdf.fileNameOverride = "引き継がない個別名";
      source.paymentCompletedDate = status === "issued" ? "2026-10-25" : null;
      data.invoices = [source];
      const before = structuredClone(data);
      const result = await getInvoiceCreationData(
        gateway,
        source.invoiceNumber,
      );
      expect(result?.source).toEqual({
        invoiceNumber: source.invoiceNumber,
        businessPartnerCode: "ACME",
        lineItems: source.lineItems,
        notes: source.notes,
      });
      expect(data).toEqual(before);
      expect(readIssuedPdf).not.toHaveBeenCalled();
    },
  );
  it("複製は元の税区分、新規は現在の標準税率を返す", async () => {
    const { data, gateway } = harness();
    data.taxCategories = [
      { ...data.taxCategories[0], deprecated: true },
      {
        id: "standard-20",
        name: "新標準",
        treatment: "taxable",
        deprecated: false,
        isStandardRate: true,
        ratePercent: 20,
      },
    ];
    expect((await getInvoiceCreationData(gateway))?.taxCategory.id).toBe(
      "standard-20",
    );
    expect(
      (await getInvoiceCreationData(gateway, data.invoices[0].invoiceNumber))
        ?.taxCategory.id,
    ).toBe("standard-10");
  });
  it("標準税率を決定できなければ作成準備も拒否する", async () => {
    const { data, gateway } = harness();
    data.taxCategories = [];
    await expect(getInvoiceCreationData(gateway)).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["taxCategories"] })],
    });
  });
  it("存在しない複製元を区別する", async () => {
    expect(
      await getInvoiceCreationData(harness().gateway, "MISSING"),
    ).toBeUndefined();
  });
});
