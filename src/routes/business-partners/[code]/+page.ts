import type { PageLoad } from "./$types";
import { loadBusinessPartnerEditor } from "#lib/ui/business-partner-editor";

export const load = (async ({ fetch, parent, params }) => {
  const { startupError } = await parent();
  if (startupError) return { editor: null };
  return { editor: await loadBusinessPartnerEditor(fetch, params.code) };
}) satisfies PageLoad;
