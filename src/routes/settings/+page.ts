import type { PageLoad } from "./$types";
import { loadSettingsScreen } from "#lib/ui/settings-editor";

export const load = (async ({ fetch, parent }) => {
  const { startupError } = await parent();
  if (startupError) return { settingsScreen: null };
  return { settingsScreen: await loadSettingsScreen(fetch) };
}) satisfies PageLoad;
