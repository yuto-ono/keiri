import { describe, expect, it, vi } from "vitest";

import type {
  InvoiceRounding,
  RoundingMethod,
  Settings,
} from "#lib/domain/model";
import { updateSettings, type SettingsUpdateGateway } from "./update-settings";

function createHarness() {
  const current: Settings = {
    revision: 3,
    rounding: { lineAmount: "floor", taxAmount: "floor" },
  };
  const loadSettings = vi.fn<SettingsUpdateGateway["loadSettings"]>(
    async () => current,
  );
  const saveSettings = vi.fn<SettingsUpdateGateway["saveSettings"]>(
    async () => ({ filePath: "settings.yaml" }),
  );
  return {
    current,
    loadSettings,
    saveSettings,
    gateway: { loadSettings, saveSettings },
  };
}

describe("端数処理設定の更新", () => {
  it.each<InvoiceRounding>([
    { lineAmount: "floor", taxAmount: "ceil" },
    { lineAmount: "halfUp", taxAmount: "floor" },
    { lineAmount: "ceil", taxAmount: "halfUp" },
  ])(
    "明細金額 $lineAmount と消費税 $taxAmount を独立に保存する",
    async (rounding) => {
      const harness = createHarness();
      const proposed = { revision: 3, rounding };
      const before = structuredClone(harness.current);
      const result = await updateSettings(harness.gateway, proposed);
      expect(result).toEqual({
        settings: { revision: 4, rounding },
        filePath: "settings.yaml",
      });
      expect(harness.saveSettings).toHaveBeenCalledWith(result.settings);
      expect(harness.saveSettings).toHaveBeenCalledOnce();
      expect(harness.current).toEqual(before);
      expect(proposed.revision).toBe(3);
      expect(result.settings.rounding).not.toBe(proposed.rounding);
    },
  );

  it("未対応の端数処理とリビジョン不一致をまとめて拒否する", async () => {
    const harness = createHarness();
    await expect(
      updateSettings(harness.gateway, {
        revision: 2,
        rounding: {
          lineAmount: "round" as RoundingMethod,
          taxAmount: "truncate" as RoundingMethod,
        },
      }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["rounding", "lineAmount"] }),
        expect.objectContaining({ path: ["rounding", "taxAmount"] }),
        expect.objectContaining({ path: ["revision"] }),
      ]),
    });
    expect(harness.saveSettings).not.toHaveBeenCalled();
  });

  it.each([0, 1.5, 2, Number.MAX_SAFE_INTEGER + 1])(
    "不正・不一致の期待リビジョン %s では保存しない",
    async (revision) => {
      const harness = createHarness();
      await expect(
        updateSettings(harness.gateway, {
          revision,
          rounding: { lineAmount: "ceil", taxAmount: "halfUp" },
        }),
      ).rejects.toMatchObject({
        issues: [expect.objectContaining({ path: ["revision"] })],
      });
      expect(harness.saveSettings).not.toHaveBeenCalled();
    },
  );

  it("読み込みに失敗した場合は保存しない", async () => {
    const harness = createHarness();
    const failure = new Error("データを読み込めません。");
    harness.loadSettings.mockRejectedValueOnce(failure);
    await expect(updateSettings(harness.gateway, harness.current)).rejects.toBe(
      failure,
    );
    expect(harness.saveSettings).not.toHaveBeenCalled();
  });

  it("保存に失敗した場合も元の設定を維持する", async () => {
    const harness = createHarness();
    const before = structuredClone(harness.current);
    const failure = new Error("保存できません。");
    harness.saveSettings.mockRejectedValueOnce(failure);
    await expect(
      updateSettings(harness.gateway, {
        revision: 3,
        rounding: { lineAmount: "halfUp", taxAmount: "ceil" },
      }),
    ).rejects.toBe(failure);
    expect(harness.current).toEqual(before);
  });
});
