export function isSameOriginWriteRequest(
  request: Request,
  requestUrl: URL,
): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  if (origin === requestUrl.origin) return true;

  // リバースプロキシ内外でURLが異なる場合は、ブラウザ自身の判定を使う。
  return request.headers.get("sec-fetch-site") === "same-origin";
}
