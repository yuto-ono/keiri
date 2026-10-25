import { describe, expect, it, vi } from "vitest";

import type {
  IssuerUpdateContext,
  IssuerUpdateGateway,
} from "#lib/application/update-issuer";
import { createIssuer, createPartner } from "#lib/testing/business-partners";
import { KeiriDataLoadError } from "#lib/server/keiri-data-loader";
import { handleUpdateIssuerRequest } from "./issuer-api";

const url = new URL("http://127.0.0.1:5173/api/issuers/issuer");

function createHarness() {
  const context: IssuerUpdateContext = {
    issuer: createIssuer(),
    businessPartners: [createPartner()],
  };
  const loadUpdateContext = vi.fn<IssuerUpdateGateway["loadUpdateContext"]>(
    async () => context,
  );
  const saveUpdatedIssuer = vi.fn<IssuerUpdateGateway["saveUpdatedIssuer"]>(
    async () => ({ filePath: "issuers/issuer.yaml" }),
  );
  return {
    context,
    loadUpdateContext,
    saveUpdatedIssuer,
    dependencies: { gateway: { loadUpdateContext, saveUpdatedIssuer } },
  };
}

function request(body: string, origin: string | null = url.origin) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (origin !== null) {
    headers.origin = origin;
  }
  return new Request(url, { method: "PUT", headers, body });
}

describe("発行者更新API", () => {
  it("発行者と振込先全体を保存し、先頭ゼロを文字列として保持する", async () => {
    const harness = createHarness();
    const proposed = {
      ...createIssuer(),
      name: "変更後",
      phone: "連絡先は個別に案内",
      bankAccounts: createIssuer().bankAccounts.map((account) => ({
        ...account,
        branchCode: "007",
        accountNumber: "0001234",
      })),
    };
    const response = await handleUpdateIssuerRequest(
      request(JSON.stringify(proposed)),
      url,
      "issuer",
      harness.dependencies,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      issuer: { ...proposed, revision: 2 },
      filePath: "issuers/issuer.yaml",
    });
    expect(harness.loadUpdateContext).toHaveBeenCalledWith("issuer");
    expect(harness.saveUpdatedIssuer).toHaveBeenCalledOnce();
  });

  it.each(["https://example.com", null])(
    "外部・未指定Origin %s を読み込み前に拒否する",
    async (origin) => {
      const harness = createHarness();
      const response = await handleUpdateIssuerRequest(
        request(JSON.stringify(createIssuer()), origin),
        url,
        "issuer",
        harness.dependencies,
      );
      expect(response.status).toBe(403);
      expect(harness.loadUpdateContext).not.toHaveBeenCalled();
      expect(harness.saveUpdatedIssuer).not.toHaveBeenCalled();
    },
  );

  it.each([
    "{",
    "{}",
    JSON.stringify({ ...createIssuer(), unknown: true }),
    JSON.stringify({ ...createIssuer(), revision: 0 }),
    JSON.stringify({ ...createIssuer(), registrationNumber: "t1234567890123" }),
    JSON.stringify({ ...createIssuer(), name: "" }),
    JSON.stringify({ ...createIssuer(), phone: "" }),
    JSON.stringify({ ...createIssuer(), bankAccounts: [] }),
    JSON.stringify({
      ...createIssuer(),
      bankAccounts: [{ ...createIssuer().bankAccounts[0], id: "bad--id" }],
    }),
    JSON.stringify({
      ...createIssuer(),
      bankAccounts: [{ ...createIssuer().bankAccounts[0], branchCode: "7" }],
    }),
    JSON.stringify({
      ...createIssuer(),
      bankAccounts: [
        { ...createIssuer().bankAccounts[0], accountNumber: 1234567 },
      ],
    }),
    JSON.stringify({
      ...createIssuer(),
      bankAccounts: [
        { ...createIssuer().bankAccounts[0], accountType: "other" },
      ],
    }),
  ])("本文の不正を400で拒否する: %s", async (body) => {
    const harness = createHarness();
    const response = await handleUpdateIssuerRequest(
      request(body),
      url,
      "issuer",
      harness.dependencies,
    );
    expect(response.status).toBe(400);
    expect(harness.loadUpdateContext).not.toHaveBeenCalled();
    expect(harness.saveUpdatedIssuer).not.toHaveBeenCalled();
  });

  it("ID変更・口座ID重複・既定の不整合・リビジョン不一致を422で返す", async () => {
    const harness = createHarness();
    const proposed = {
      ...createIssuer(),
      id: "OTHER",
      revision: 2,
      bankAccounts: [
        ...createIssuer().bankAccounts,
        { ...createIssuer().bankAccounts[0], id: "PRIMARY" },
      ],
      defaultBankAccountId: "missing",
    };
    const response = await handleUpdateIssuerRequest(
      request(JSON.stringify(proposed)),
      url,
      "issuer",
      harness.dependencies,
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["id"] }),
        expect.objectContaining({ path: ["revision"] }),
        expect.objectContaining({ path: ["bankAccounts", 2, "id"] }),
        expect.objectContaining({ path: ["defaultBankAccountId"] }),
      ]),
    });
    expect(harness.saveUpdatedIssuer).not.toHaveBeenCalled();
  });

  it("取引先から参照中の連絡先・振込先の削除を422で拒否する", async () => {
    const harness = createHarness();
    harness.context.businessPartners = [
      createPartner({
        issuerDisplay: {
          phone: true,
          email: false,
          bankAccountIds: ["primary"],
        },
      }),
    ];
    const proposed = {
      ...createIssuer(),
      phone: null,
      bankAccounts: [createIssuer().bankAccounts[1]],
      defaultBankAccountId: "secondary",
    };
    const response = await handleUpdateIssuerRequest(
      request(JSON.stringify(proposed)),
      url,
      "issuer",
      harness.dependencies,
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["phone"] }),
        expect.objectContaining({ path: ["bankAccounts"] }),
      ]),
    });
    expect(harness.saveUpdatedIssuer).not.toHaveBeenCalled();
  });

  it("存在しない発行者を422で返す", async () => {
    const harness = createHarness();
    harness.context.issuer = undefined;
    const response = await handleUpdateIssuerRequest(
      request(JSON.stringify(createIssuer())),
      url,
      "MISSING",
      harness.dependencies,
    );
    expect(response.status).toBe(422);
    expect(harness.saveUpdatedIssuer).not.toHaveBeenCalled();
  });

  it("読み込みエラーを対象パスと理由付きの500で返す", async () => {
    const harness = createHarness();
    const issues = [
      {
        filePath: "issuers/issuer.yaml",
        path: ["name"],
        message: "氏名がありません。",
      },
    ];
    harness.loadUpdateContext.mockRejectedValueOnce(
      new KeiriDataLoadError(issues),
    );
    const response = await handleUpdateIssuerRequest(
      request(JSON.stringify(createIssuer())),
      url,
      "issuer",
      harness.dependencies,
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ issues });
    expect(harness.saveUpdatedIssuer).not.toHaveBeenCalled();
  });
});
