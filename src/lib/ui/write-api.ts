import { decodeJsonApiResponse, type ApiReadResult } from "#lib/ui/read-api";

export async function writeJsonApi<T>(
  fetcher: typeof fetch,
  url: string,
  method: "POST" | "PUT" | "DELETE",
  body: unknown,
): Promise<ApiReadResult<T>> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      error: {
        message:
          "送信結果を確認できませんでした。入力内容を維持しています。再送する前に最新データを読み直して結果を確認してください。",
        issues: [],
      },
    };
  }
  return decodeJsonApiResponse<T>(response);
}
