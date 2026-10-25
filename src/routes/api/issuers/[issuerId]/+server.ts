import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import {
  DataDirectoryConfigurationError,
  resolveKeiriDataDirectory,
} from "#lib/server/data-directory";
import { FileIssuerUpdateGateway } from "#lib/server/file-issuer-update-gateway";
import { handleUpdateIssuerRequest } from "#lib/server/issuer-api";
import { handleGetIssuerRequest } from "#lib/server/read-api";

export const GET: RequestHandler = ({ params }) =>
  handleGetIssuerRequest(params.issuerId);

export const PUT: RequestHandler = async ({ request, url, params }) => {
  try {
    const directory = resolveKeiriDataDirectory(process.cwd());
    return handleUpdateIssuerRequest(request, url, params.issuerId, {
      gateway: new FileIssuerUpdateGateway(directory),
    });
  } catch (error) {
    if (error instanceof DataDirectoryConfigurationError) {
      return json({ message: error.message }, { status: 500 });
    }
    throw error;
  }
};
