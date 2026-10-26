export interface ApiIssue {
  filePath?: string;
  path: readonly (string | number)[];
  message: string;
  line?: number;
  column?: number;
}

export interface ApiReadError {
  message: string;
  issues: readonly ApiIssue[];
}

export type ApiReadResult<T> =
  { ok: true; value: T } | { ok: false; error: ApiReadError };

export async function readJsonApi<T>(
  fetcher: typeof fetch,
  url: string,
): Promise<ApiReadResult<T>> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      error: {
        message:
          "サーバーに接続できませんでした。接続を確認して再読み込みしてください。",
        issues: [],
      },
    };
  }
  return decodeJsonApiResponse<T>(response);
}

export async function decodeJsonApiResponse<T>(
  response: Response,
): Promise<ApiReadResult<T>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: {
        message:
          "サーバーの応答を読み取れませんでした。再読み込みしてください。",
        issues: [],
      },
    };
  }
  if (response.ok) {
    return { ok: true, value: body as T };
  }
  const errorBody = isRecord(body) ? body : {};
  return {
    ok: false,
    error: {
      message:
        typeof errorBody.message === "string"
          ? errorBody.message
          : `データを読み込めませんでした（HTTP ${response.status}）。`,
      issues: Array.isArray(errorBody.issues)
        ? errorBody.issues.filter(isApiIssue)
        : [],
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isApiIssue(value: unknown): value is ApiIssue {
  return (
    isRecord(value) &&
    typeof value.message === "string" &&
    Array.isArray(value.path) &&
    value.path.every(
      (part) => typeof part === "string" || typeof part === "number",
    ) &&
    (value.filePath === undefined || typeof value.filePath === "string") &&
    (value.line === undefined || typeof value.line === "number") &&
    (value.column === undefined || typeof value.column === "number")
  );
}
