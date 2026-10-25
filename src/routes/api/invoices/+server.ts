import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";

import { todayInTokyo } from "../../../lib/domain/business-date";
import {
  DataDirectoryConfigurationError,
  resolveKeiriDataDirectory,
} from "../../../lib/server/data-directory";
import { FileInvoiceCreationGateway } from "../../../lib/server/file-invoice-creation-gateway";
import { handleCreateInvoiceRequest } from "../../../lib/server/invoice-api";

export const POST: RequestHandler = async ({ request, url }) => {
  try {
    const dataDirectory = resolveKeiriDataDirectory(process.cwd());
    return handleCreateInvoiceRequest(request, url, {
      gateway: new FileInvoiceCreationGateway(dataDirectory),
      today: todayInTokyo(),
    });
  } catch (error) {
    if (error instanceof DataDirectoryConfigurationError) {
      return json({ message: error.message }, { status: 500 });
    }
    throw error;
  }
};
