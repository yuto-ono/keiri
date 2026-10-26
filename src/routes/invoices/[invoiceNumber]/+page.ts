import type { PageLoad } from "./$types";
import type { InvoiceDetailData } from "#lib/ui/invoice-editor";
import { invoiceApiPath } from "#lib/ui/invoice-editor";
import { readJsonApi } from "#lib/ui/read-api";

export const load = (async ({ fetch, parent, params }) => {
  const { startupError } = await parent();
  if (startupError) return { detail: null };
  return {
    detail: await readJsonApi<InvoiceDetailData>(
      fetch,
      invoiceApiPath(params.invoiceNumber),
    ),
  };
}) satisfies PageLoad;
