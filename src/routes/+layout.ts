import type { LayoutLoad } from "./$types";
import type { Settings } from "#lib/domain/model";
import { readJsonApi } from "#lib/ui/read-api";

export const ssr = false;

export const load = (async ({ fetch }) => {
  const result = await readJsonApi<{ settings: Settings }>(
    fetch,
    "/api/settings",
  );
  return { startupError: result.ok ? null : result.error };
}) satisfies LayoutLoad;
