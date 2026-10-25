import { resolve } from "node:path";

import type { SettingsUpdateGateway } from "#lib/application/update-settings";
import type { Settings } from "#lib/domain/model";
import { settingsSchema } from "#lib/persistence/schemas";
import { parseYaml } from "#lib/persistence/yaml-parser";
import { serializeSettings } from "#lib/persistence/yaml-serializer";
import { writeTextFileAtomically } from "#lib/server/atomic-write";
import { loadKeiriData } from "#lib/server/keiri-data-loader";

export class FileSettingsUpdateGateway implements SettingsUpdateGateway {
  readonly #rootDirectory: string;

  constructor(rootDirectory: string) {
    this.#rootDirectory = rootDirectory;
  }

  async loadSettings(): Promise<Settings> {
    return (await loadKeiriData(this.#rootDirectory)).settings.data;
  }

  async saveSettings(settings: Settings): Promise<{ filePath: string }> {
    const filePath = "settings.yaml";
    await writeTextFileAtomically(
      resolve(this.#rootDirectory, filePath),
      serializeSettings(settings),
      {
        overwrite: true,
        validate: (contents) => {
          parseYaml(contents, filePath, settingsSchema);
        },
      },
    );
    return { filePath };
  }
}
