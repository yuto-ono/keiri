import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import {
  DataDirectoryConfigurationError,
  resolveKeiriDataDirectory,
} from "#lib/server/data-directory";
import { FileInvoiceRevertToDraftGateway } from "#lib/server/file-invoice-revert-to-draft-gateway";
import { handleRevertInvoiceToDraftRequest } from "#lib/server/invoice-api";

export const POST: RequestHandler = async ({ request, url, params }) => {
  try {
    const dataDirectory = resolveKeiriDataDirectory(process.cwd());
    return handleRevertInvoiceToDraftRequest(
      request,
      url,
      params.invoiceNumber,
      {
        gateway: new FileInvoiceRevertToDraftGateway(dataDirectory),
      },
    );
  } catch (error) {
    if (error instanceof DataDirectoryConfigurationError) {
      return json({ message: error.message }, { status: 500 });
    }
    throw error;
  }
};
