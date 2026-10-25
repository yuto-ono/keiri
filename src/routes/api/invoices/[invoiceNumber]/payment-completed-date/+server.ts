import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { todayInTokyo } from "#lib/domain/business-date";
import {
  DataDirectoryConfigurationError,
  resolveKeiriDataDirectory,
} from "#lib/server/data-directory";
import { FileInvoicePaymentGateway } from "#lib/server/file-invoice-payment-gateway";
import {
  handleDeleteInvoicePaymentCompletedDateRequest,
  handleSetInvoicePaymentCompletedDateRequest,
} from "#lib/server/invoice-payment-api";

export const PUT: RequestHandler = async ({ request, url, params }) => {
  try {
    const dataDirectory = resolveKeiriDataDirectory(process.cwd());
    return handleSetInvoicePaymentCompletedDateRequest(
      request,
      url,
      params.invoiceNumber,
      {
        gateway: new FileInvoicePaymentGateway(dataDirectory),
        today: todayInTokyo(),
      },
    );
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
    return handleDeleteInvoicePaymentCompletedDateRequest(
      request,
      url,
      params.invoiceNumber,
      {
        gateway: new FileInvoicePaymentGateway(dataDirectory),
      },
    );
  } catch (error) {
    if (error instanceof DataDirectoryConfigurationError) {
      return json({ message: error.message }, { status: 500 });
    }
    throw error;
  }
};
