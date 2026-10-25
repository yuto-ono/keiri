import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { todayInTokyo } from "#lib/domain/business-date";
import {
  DataDirectoryConfigurationError,
  resolveKeiriDataDirectory,
} from "#lib/server/data-directory";
import { FileInvoiceIssueGateway } from "#lib/server/file-invoice-issue-gateway";
import { handleIssueInvoiceRequest } from "#lib/server/invoice-api";
import { PlaywrightInvoicePdfRenderer } from "#lib/server/playwright-invoice-pdf-renderer";

export const POST: RequestHandler = async ({ request, url, params }) => {
  try {
    const repositoryRoot = process.cwd();
    const dataDirectory = resolveKeiriDataDirectory(repositoryRoot);
    return handleIssueInvoiceRequest(request, url, params.invoiceNumber, {
      gateway: new FileInvoiceIssueGateway(dataDirectory),
      renderer: new PlaywrightInvoicePdfRenderer(repositoryRoot),
      today: todayInTokyo(),
    });
  } catch (error) {
    if (error instanceof DataDirectoryConfigurationError) {
      return json({ message: error.message }, { status: 500 });
    }
    throw error;
  }
};
