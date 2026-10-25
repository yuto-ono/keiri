import { json } from "@sveltejs/kit";

import {
  updateSettings,
  type SettingsUpdateGateway,
} from "#lib/application/update-settings";
import { DomainValidationError } from "#lib/domain/domain-validation-error";
import { settingsSchema } from "#lib/persistence/schemas";
import { DataDirectoryConfigurationError } from "#lib/server/data-directory";
import { KeiriDataLoadError } from "#lib/server/keiri-data-loader";

export async function handleUpdateSettingsRequest(
  request: Request,
  url: URL,
  dependencies: { gateway: SettingsUpdateGateway },
): Promise<Response> {
  if (request.headers.get("origin") !== url.origin) {
    return json(
      { message: "同一オリジン以外からの書き込みは受け付けません。" },
      { status: 403 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      { message: "リクエスト本文をJSONとして解析できません。" },
      { status: 400 },
    );
  }
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        message: "端数処理設定の更新内容が不正です。",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }
  try {
    return json(await updateSettings(dependencies.gateway, parsed.data));
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return json(
        { message: error.message, issues: error.issues },
        { status: 422 },
      );
    }
    if (error instanceof KeiriDataLoadError) {
      return json(
        { message: error.message, issues: error.issues },
        { status: 500 },
      );
    }
    if (error instanceof DataDirectoryConfigurationError) {
      return json({ message: error.message }, { status: 500 });
    }
    throw error;
  }
}
