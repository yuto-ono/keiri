import { describe, expect, it, vi } from "vitest";
import type {
  BusinessPartnerManagementContext,
  BusinessPartnerManagementGateway,
} from "#lib/application/manage-business-partners";
import {
  createInvoiceForPartner,
  createIssuer,
  createPartner,
} from "#lib/testing/business-partners";
import {
  handleCreateBusinessPartnerRequest,
  handleDeleteBusinessPartnerRequest,
  handleUpdateBusinessPartnerRequest,
} from "./business-partner-api";

const url = new URL("http://127.0.0.1:5173/api/business-partners/ACME");

function createHarness() {
  const context: BusinessPartnerManagementContext = {
    businessPartners: [createPartner()],
    issuers: [createIssuer()],
    invoices: [],
  };
  const saved = vi.fn(async () => ({
    filePath: "business-partners/NewCo.yaml",
  }));
  const gateway: BusinessPartnerManagementGateway = {
    async loadManagementContext() {
      return context;
    },
    saveNewBusinessPartner: saved,
    saveUpdatedBusinessPartner: saved,
    deleteBusinessPartner: saved,
  };
  return { context, saved, dependencies: { gateway } };
}

function input() {
  return {
    code: "NewCo",
    addressee: "新しい宛名",
    honorific: "様",
    requiresMonthlyInvoice: false,
    unitPricesIncludeTax: true,
  };
}

function handle(
  method: string,
  harness: ReturnType<typeof createHarness>,
  body?: string,
  origin: string | null = url.origin,
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (origin !== null) {
    headers.origin = origin;
  }
  const request = new Request(url, {
    method,
    headers,
    body:
      body ??
      JSON.stringify(
        method === "POST"
          ? input()
          : method === "PUT"
            ? createPartner({ code: "NewCo" })
            : { revision: 1 },
      ),
  });
  if (method === "POST") {
    return handleCreateBusinessPartnerRequest(
      request,
      url,
      harness.dependencies,
    );
  }
  if (method === "PUT") {
    return handleUpdateBusinessPartnerRequest(
      request,
      url,
      "ACME",
      harness.dependencies,
    );
  }
  return handleDeleteBusinessPartnerRequest(
    request,
    url,
    "ACME",
    harness.dependencies,
  );
}

describe("取引先管理API", () => {
  it("POSTで初期値を補ったrevision 1の取引先を登録する", async () => {
    const harness = createHarness();
    const response = await handle("POST", harness);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      businessPartner: {
        ...input(),
        revision: 1,
        billingInstructions: null,
        issuerDisplay: {
          phone: true,
          email: false,
          bankAccountIds: ["primary"],
        },
      },
    });
    expect(harness.saved).toHaveBeenCalledOnce();
  });

  it("PUTで未参照のコードを変更できる", async () => {
    const response = await handle("PUT", createHarness());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      businessPartner: { code: "NewCo", revision: 2 },
    });
  });

  it("DELETEで未参照の取引先を削除する", async () => {
    const harness = createHarness();
    const response = await handle("DELETE", harness);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ code: "ACME" });
    expect(harness.saved).toHaveBeenCalledWith(createPartner());
  });

  it.each(["POST", "PUT", "DELETE"])(
    "%s の外部・未指定Originを拒否する",
    async (method) => {
      for (const origin of ["https://example.com", null]) {
        const harness = createHarness();
        const response = await handle(method, harness, undefined, origin);
        expect(response.status).toBe(403);
        expect(harness.saved).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    { method: "POST", body: "{" },
    { method: "POST", body: JSON.stringify({ ...input(), revision: 10 }) },
    { method: "POST", body: JSON.stringify({ ...input(), unknown: true }) },
    { method: "POST", body: JSON.stringify({ ...input(), code: "bad/code" }) },
    {
      method: "POST",
      body: JSON.stringify({ ...input(), pdfFileNamePattern: "{unknown}" }),
    },
    { method: "PUT", body: "{}" },
    {
      method: "PUT",
      body: JSON.stringify({ ...createPartner(), revision: 0 }),
    },
    { method: "DELETE", body: "{}" },
    { method: "DELETE", body: '{"revision":1,"code":"OTHER"}' },
  ])("$method で不正な本文を400で拒否する: $body", async ({ method, body }) => {
    const harness = createHarness();
    const response = await handle(method, harness, body);
    expect(response.status).toBe(400);
    expect(harness.saved).not.toHaveBeenCalled();
  });

  it("登録済みコードと表示できない連絡先を422で拒否する", async () => {
    const harness = createHarness();
    const response = await handle(
      "POST",
      harness,
      JSON.stringify({
        ...input(),
        code: "acme",
        issuerDisplay: {
          phone: false,
          email: true,
          bankAccountIds: ["missing"],
        },
      }),
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["code"] }),
        expect.objectContaining({ path: ["issuerDisplay", "email"] }),
        expect.objectContaining({
          path: ["issuerDisplay", "bankAccountIds", 0],
        }),
      ]),
    });
    expect(harness.saved).not.toHaveBeenCalled();
  });

  it.each(["PUT", "DELETE"])(
    "%s で請求書からの参照とリビジョン不一致を拒否する",
    async (method) => {
      const harness = createHarness();
      harness.context.invoices = [createInvoiceForPartner()];
      harness.context.businessPartners = [createPartner({ revision: 2 })];
      const response = await handle(method, harness);
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ["revision"] }),
          expect.objectContaining({ path: ["code"] }),
        ]),
      });
      expect(harness.saved).not.toHaveBeenCalled();
    },
  );
});
