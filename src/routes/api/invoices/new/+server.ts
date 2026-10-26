import type { RequestHandler } from "./$types";
import { handleGetInvoiceCreationDataRequest } from "#lib/server/read-api";
export const GET: RequestHandler = () => handleGetInvoiceCreationDataRequest();
