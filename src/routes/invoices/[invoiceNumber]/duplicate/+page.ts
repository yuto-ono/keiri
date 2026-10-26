import type { PageLoad } from "./$types";
import { readJsonApi } from "#lib/ui/read-api";
import { invoiceApiPath } from "#lib/ui/invoice-editor";
import type { InvoiceCreationScreenData } from "#lib/ui/invoice-creation";
export const load = (async ({ fetch, parent, params }) => {
  const { startupError } = await parent();
  if (startupError) return { creation: null };
  return {
    creation: await readJsonApi<InvoiceCreationScreenData>(
      fetch,
      `${invoiceApiPath(params.invoiceNumber)}/duplicate`,
    ),
  };
}) satisfies PageLoad;
