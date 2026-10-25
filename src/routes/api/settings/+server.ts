import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import {
  DataDirectoryConfigurationError,
  resolveKeiriDataDirectory,
} from "#lib/server/data-directory";
import { FileSettingsUpdateGateway } from "#lib/server/file-settings-update-gateway";
import { handleUpdateSettingsRequest } from "#lib/server/settings-api";

export const PUT: RequestHandler = async ({ request, url }) => {
  try {
    const directory = resolveKeiriDataDirectory(process.cwd());
    return handleUpdateSettingsRequest(request, url, {
      gateway: new FileSettingsUpdateGateway(directory),
    });
  } catch (error) {
    if (error instanceof DataDirectoryConfigurationError) {
      return json({ message: error.message }, { status: 500 });
    }
    throw error;
  }
};
