import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import {
  handleDeleteBusinessPartnerRequest,
  handleUpdateBusinessPartnerRequest,
} from "#lib/server/business-partner-api";
import {
  DataDirectoryConfigurationError,
  resolveKeiriDataDirectory,
} from "#lib/server/data-directory";
import { FileBusinessPartnerGateway } from "#lib/server/file-business-partner-gateway";
import { handleGetBusinessPartnerRequest } from "#lib/server/read-api";

export const GET: RequestHandler = ({ params }) =>
  handleGetBusinessPartnerRequest(params.code);

export const PUT: RequestHandler = async ({ request, url, params }) => {
  try {
    const directory = resolveKeiriDataDirectory(process.cwd());
    return handleUpdateBusinessPartnerRequest(request, url, params.code, {
      gateway: new FileBusinessPartnerGateway(directory),
    });
  } catch (error) {
    if (error instanceof DataDirectoryConfigurationError) {
      return json({ message: error.message }, { status: 500 });
    }
    throw error;
  }
};

export const DELETE: RequestHandler = async ({ request, url, params }) => {
  try {
    const directory = resolveKeiriDataDirectory(process.cwd());
    return handleDeleteBusinessPartnerRequest(request, url, params.code, {
      gateway: new FileBusinessPartnerGateway(directory),
    });
  } catch (error) {
    if (error instanceof DataDirectoryConfigurationError) {
      return json({ message: error.message }, { status: 500 });
    }
    throw error;
  }
};
