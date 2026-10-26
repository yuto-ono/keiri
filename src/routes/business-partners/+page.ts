import type { PageLoad } from "./$types";
import type { BusinessPartnerListData } from "#lib/ui/business-partner-editor";
import { readJsonApi } from "#lib/ui/read-api";

export const load = (async ({ fetch, parent }) => {
  const { startupError } = await parent();
  if (startupError) return { partners: null };
  return {
    partners: await readJsonApi<BusinessPartnerListData>(
      fetch,
      "/api/business-partners",
    ),
  };
}) satisfies PageLoad;
