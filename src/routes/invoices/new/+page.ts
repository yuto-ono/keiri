import type { PageLoad } from "./$types";
import { readJsonApi } from "#lib/ui/read-api";
import type { InvoiceCreationScreenData } from "#lib/ui/invoice-creation";
export const load = (async ({ fetch, parent }) => {
  const { startupError } = await parent();
  if (startupError) return { creation: null };
  return {
    creation: await readJsonApi<InvoiceCreationScreenData>(
      fetch,
      "/api/invoices/new",
    ),
  };
}) satisfies PageLoad;
