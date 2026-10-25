import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { handleCreateBusinessPartnerRequest } from "#lib/server/business-partner-api";
import {
  DataDirectoryConfigurationError,
  resolveKeiriDataDirectory,
} from "#lib/server/data-directory";
import { FileBusinessPartnerGateway } from "#lib/server/file-business-partner-gateway";
import { handleListBusinessPartnersRequest } from "#lib/server/read-api";

export const GET: RequestHandler = () => handleListBusinessPartnersRequest();

export const POST: RequestHandler = async ({ request, url }) => {
  try {
    const directory = resolveKeiriDataDirectory(process.cwd());
    return handleCreateBusinessPartnerRequest(request, url, {
      gateway: new FileBusinessPartnerGateway(directory),
    });
  } catch (error) {
    if (error instanceof DataDirectoryConfigurationError) {
      return json({ message: error.message }, { status: 500 });
    }
    throw error;
  }
};
