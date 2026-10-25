import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { todayInTokyo } from "#lib/domain/business-date";
import {
  DataDirectoryConfigurationError,
  resolveKeiriDataDirectory,
} from "#lib/server/data-directory";
import { FileInvoiceCreationGateway } from "#lib/server/file-invoice-creation-gateway";
import { handleDuplicateInvoiceRequest } from "#lib/server/invoice-api";

export const POST: RequestHandler = async ({ request, url, params }) => {
  try {
    const dataDirectory = resolveKeiriDataDirectory(process.cwd());
    return handleDuplicateInvoiceRequest(request, url, params.invoiceNumber, {
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
