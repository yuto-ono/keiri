import { describe, expect, it } from "vitest";

import {
  DataDirectoryConfigurationError,
  resolveKeiriDataDirectory,
} from "./data-directory";

describe("keiri-dataのパス解決", () => {
  it("相対パスをkeiriリポジトリルート基準で解決する", () => {
    expect(
      resolveKeiriDataDirectory("/work/keiri", {
        KEIRI_DATA_DIR: "../keiri-data",
      }),
    ).toBe("/work/keiri-data");
  });

  it("絶対パスをそのまま正規化する", () => {
    expect(
      resolveKeiriDataDirectory("/work/keiri", {
        KEIRI_DATA_DIR: "/data/./keiri-data",
      }),
    ).toBe("/data/keiri-data");
  });

  it.each([{}, { KEIRI_DATA_DIR: "" }])("未指定を拒否する", (environment) => {
    expect(() => resolveKeiriDataDirectory("/work/keiri", environment)).toThrow(
      DataDirectoryConfigurationError,
    );
  });
});
