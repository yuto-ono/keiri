import type { PageLoad } from "./$types";
import { loadBusinessPartnerEditor } from "#lib/ui/business-partner-editor";

export const load = (async ({ fetch, parent }) => {
  const { startupError } = await parent();
  if (startupError) return { editor: null };
  return { editor: await loadBusinessPartnerEditor(fetch) };
}) satisfies PageLoad;
