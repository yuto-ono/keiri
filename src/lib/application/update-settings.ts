import { DomainValidationError } from "#lib/domain/domain-validation-error";
import type { Settings } from "#lib/domain/model";
import { validateRoundingSettings } from "#lib/domain/rounding";

export interface SettingsUpdateGateway {
  loadSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<{ filePath: string }>;
}

export interface UpdateSettingsResult {
  settings: Settings;
  filePath: string;
}

export async function updateSettings(
  gateway: SettingsUpdateGateway,
  proposed: Settings,
): Promise<UpdateSettingsResult> {
  const current = await gateway.loadSettings();
  const issues = validateRoundingSettings(proposed.rounding);
  if (!Number.isSafeInteger(proposed.revision) || proposed.revision < 1) {
    issues.push({
      path: ["revision"],
      message: "期待リビジョンは1以上の安全な整数にしてください。",
    });
  } else if (proposed.revision !== current.revision) {
    issues.push({
      path: ["revision"],
      message: `期待リビジョン${proposed.revision}は現在のリビジョン${current.revision}と一致しません。`,
    });
  }
  if (issues.length > 0) {
    throw new DomainValidationError("端数処理設定を更新できません。", issues);
  }
  const settings: Settings = {
    revision: current.revision + 1,
    rounding: { ...proposed.rounding },
  };
  const saved = await gateway.saveSettings(settings);
  return { settings, filePath: saved.filePath };
}
