import type { RequestHandler } from "./$types";
import { handleGetDashboardRequest } from "#lib/server/read-api";

export const GET: RequestHandler = () => handleGetDashboardRequest();
