import { describe, expect, it, vi } from "vitest";

import type { SettingsUpdateGateway } from "#lib/application/update-settings";
import type { Settings } from "#lib/domain/model";
import { KeiriDataLoadError } from "#lib/server/keiri-data-loader";
import { handleUpdateSettingsRequest } from "./settings-api";

const url = new URL("http://127.0.0.1:5173/api/settings");

function createHarness() {
  const settings: Settings = {
    revision: 1,
    rounding: { lineAmount: "floor", taxAmount: "floor" },
  };
  const loadSettings = vi.fn<SettingsUpdateGateway["loadSettings"]>(
    async () => settings,
  );
  const saveSettings = vi.fn<SettingsUpdateGateway["saveSettings"]>(
    async () => ({ filePath: "settings.yaml" }),
  );
  return {
    settings,
    loadSettings,
    saveSettings,
    dependencies: { gateway: { loadSettings, saveSettings } },
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

describe("端数処理設定の更新API", () => {
  it("明細金額と消費税額の端数処理を保存して更新後リビジョンを返す", async () => {
    const harness = createHarness();
    const proposed = {
      revision: 1,
      rounding: { lineAmount: "ceil", taxAmount: "halfUp" },
    };
    const response = await handleUpdateSettingsRequest(
      request(JSON.stringify(proposed)),
      url,
      harness.dependencies,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      settings: { ...proposed, revision: 2 },
      filePath: "settings.yaml",
    });
    expect(harness.saveSettings).toHaveBeenCalledOnce();
  });

  it.each(["https://example.com", null])(
    "外部・未指定Origin %s を読み込み前に拒否する",
    async (origin) => {
      const harness = createHarness();
      const response = await handleUpdateSettingsRequest(
        request(JSON.stringify(harness.settings), origin),
        url,
        harness.dependencies,
      );
      expect(response.status).toBe(403);
      expect(harness.loadSettings).not.toHaveBeenCalled();
      expect(harness.saveSettings).not.toHaveBeenCalled();
    },
  );

  it.each([
    "{",
    "{}",
    '{"revision":1,"rounding":{"lineAmount":"floor"}}',
    '{"revision":1,"rounding":{"lineAmount":"floor","taxAmount":"round"}}',
    '{"revision":1,"rounding":{"lineAmount":"Floor","taxAmount":"floor"}}',
    '{"revision":1,"rounding":{"lineAmount":"floor","taxAmount":"floor","unknown":true}}',
    '{"revision":1,"rounding":{"lineAmount":"floor","taxAmount":"floor"},"issuer":{"name":"未保存の発行者"}}',
    '{"revision":0,"rounding":{"lineAmount":"floor","taxAmount":"floor"}}',
    '{"revision":"1","rounding":{"lineAmount":"floor","taxAmount":"floor"}}',
  ])("不足・不正な本文や別フォームの項目を400で拒否する: %s", async (body) => {
    const harness = createHarness();
    const response = await handleUpdateSettingsRequest(
      request(body),
      url,
      harness.dependencies,
    );
    expect(response.status).toBe(400);
    expect(harness.loadSettings).not.toHaveBeenCalled();
    expect(harness.saveSettings).not.toHaveBeenCalled();
  });

  it("リビジョン不一致を422で返して設定を上書きしない", async () => {
    const harness = createHarness();
    const response = await handleUpdateSettingsRequest(
      request(JSON.stringify({ ...harness.settings, revision: 2 })),
      url,
      harness.dependencies,
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      issues: [expect.objectContaining({ path: ["revision"] })],
    });
    expect(harness.saveSettings).not.toHaveBeenCalled();
  });

  it("データ読み込みエラーを対象パスと理由付きの500で返す", async () => {
    const harness = createHarness();
    const issues = [
      {
        filePath: "settings.yaml",
        path: ["rounding", "lineAmount"],
        message: "端数処理が不正です。",
      },
    ];
    harness.loadSettings.mockRejectedValueOnce(new KeiriDataLoadError(issues));
    const response = await handleUpdateSettingsRequest(
      request(JSON.stringify(harness.settings)),
      url,
      harness.dependencies,
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ issues });
    expect(harness.saveSettings).not.toHaveBeenCalled();
  });
});
