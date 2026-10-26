import type { PageLoad } from "./$types";
import type { InvoiceListResult } from "#lib/application/read-keiri-data";
import { readJsonApi } from "#lib/ui/read-api";

export const load = (async ({ fetch, parent, url }) => {
  const { startupError } = await parent();
  if (startupError) return { invoices: null };
  return {
    invoices: await readJsonApi<InvoiceListResult>(
      fetch,
      `/api/invoices${url.search}`,
    ),
  };
}) satisfies PageLoad;
