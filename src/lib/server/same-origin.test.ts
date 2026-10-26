import { describe, expect, it } from "vitest";

import { isSameOriginWriteRequest } from "./same-origin";

const requestUrl = new URL("http://127.0.0.1:5173/api/example");

describe("書き込みリクエストの同一オリジン判定", () => {
  it("OriginがリクエストURLと一致する場合は許可する", () => {
    const request = new Request(requestUrl, {
      headers: { origin: requestUrl.origin },
    });

    expect(isSameOriginWriteRequest(request, requestUrl)).toBe(true);
  });

  it("リバースプロキシ内外でURLが異なってもブラウザのsame-origin判定を許可する", () => {
    const request = new Request(requestUrl, {
      headers: {
        origin: "http://keiri.localhost:3650",
        "sec-fetch-site": "same-origin",
      },
    });

    expect(isSameOriginWriteRequest(request, requestUrl)).toBe(true);
  });

  it.each([
    { origin: "https://example.com", fetchSite: "cross-site" },
    { origin: "https://example.com", fetchSite: null },
    { origin: null, fetchSite: "same-origin" },
  ])("外部または未指定Originを拒否する: $origin / $fetchSite", (input) => {
    const headers = new Headers();
    if (input.origin !== null) headers.set("origin", input.origin);
    if (input.fetchSite !== null)
      headers.set("sec-fetch-site", input.fetchSite);
    const request = new Request(requestUrl, { headers });

    expect(isSameOriginWriteRequest(request, requestUrl)).toBe(false);
  });
});
