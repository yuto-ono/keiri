import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import {
  DataDirectoryConfigurationError,
  resolveKeiriDataDirectory,
} from "#lib/server/data-directory";
import { FileInvoiceUpdateGateway } from "#lib/server/file-invoice-update-gateway";
import { FileInvoiceDeletionGateway } from "#lib/server/file-invoice-deletion-gateway";
import {
  handleDeleteInvoiceRequest,
  handleUpdateInvoiceRequest,
} from "#lib/server/invoice-api";

export const PUT: RequestHandler = async ({ request, url, params }) => {
  try {
    const dataDirectory = resolveKeiriDataDirectory(process.cwd());
    return handleUpdateInvoiceRequest(request, url, params.invoiceNumber, {
      gateway: new FileInvoiceUpdateGateway(dataDirectory),
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
    const dataDirectory = resolveKeiriDataDirectory(process.cwd());
    return handleDeleteInvoiceRequest(request, url, params.invoiceNumber, {
      gateway: new FileInvoiceDeletionGateway(dataDirectory),
    });
  } catch (error) {
    if (error instanceof DataDirectoryConfigurationError) {
      return json({ message: error.message }, { status: 500 });
    }
    throw error;
  }
};
