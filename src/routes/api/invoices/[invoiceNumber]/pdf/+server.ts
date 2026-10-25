import type { RequestHandler } from "./$types";
import { handleGetInvoicePdfRequest } from "#lib/server/read-api";

export const GET: RequestHandler = ({ params }) =>
  handleGetInvoicePdfRequest(params.invoiceNumber);
