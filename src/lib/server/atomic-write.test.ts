import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeTextFileAtomically } from "./atomic-write";

let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "keiri-atomic-write-"));
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe("atomicなテキストファイル保存", () => {
  it("同じディレクトリの一時ファイルを検証して保存する", async () => {
    const targetPath = join(temporaryDirectory, "nested/data.yaml");
    const validated: string[] = [];

    await writeTextFileAtomically(targetPath, "revision: 1\n", {
      overwrite: false,
      validate(contents) {
        validated.push(contents);
      },
    });

    expect(await readFile(targetPath, "utf8")).toBe("revision: 1\n");
    expect(validated).toEqual(["revision: 1\n", "revision: 1\n"]);
    expect(await readdir(join(temporaryDirectory, "nested"))).toEqual([
      "data.yaml",
    ]);
  });

  it("検証失敗時は元のファイルを維持し一時ファイルを除去する", async () => {
    const targetPath = join(temporaryDirectory, "data.yaml");
    await writeFile(targetPath, "revision: 1\n");
    let validationCount = 0;

    await expect(
      writeTextFileAtomically(targetPath, "invalid\n", {
        overwrite: true,
        validate() {
          validationCount += 1;
          if (validationCount === 2) {
            throw new Error("検証失敗");
          }
        },
      }),
    ).rejects.toThrow("検証失敗");

    expect(await readFile(targetPath, "utf8")).toBe("revision: 1\n");
    expect(validationCount).toBe(2);
    expect(await readdir(temporaryDirectory)).toEqual(["data.yaml"]);
  });

  it("上書き禁止時は既存ファイルを変更しない", async () => {
    const targetPath = join(temporaryDirectory, "data.yaml");
    await writeFile(targetPath, "original\n");

    await expect(
      writeTextFileAtomically(targetPath, "replacement\n", {
        overwrite: false,
        validate() {},
      }),
    ).rejects.toThrow("既に存在します");
    expect(await readFile(targetPath, "utf8")).toBe("original\n");
  });
});
