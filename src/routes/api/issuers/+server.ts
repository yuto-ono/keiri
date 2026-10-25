import type { RequestHandler } from "./$types";
import { handleListIssuersRequest } from "#lib/server/read-api";

export const GET: RequestHandler = () => handleListIssuersRequest();
