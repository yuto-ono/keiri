import type { PageLoad } from "./$types";
import type { getDashboard } from "#lib/application/read-dashboard";
import { readJsonApi } from "#lib/ui/read-api";

export const load = (async ({ fetch, parent }) => {
  const { startupError } = await parent();
  if (startupError) return { dashboard: null };
  return {
    dashboard: await readJsonApi<Awaited<ReturnType<typeof getDashboard>>>(
      fetch,
      "/api/dashboard",
    ),
  };
}) satisfies PageLoad;
