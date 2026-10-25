import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  moveTextFileAtomically,
  writeTextFileAtomically,
} from "./atomic-write";

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

  it("検証済みの内容を別のパスへ移し、元のファイルを除去する", async () => {
    const sourcePath = join(temporaryDirectory, "2026/data.yaml");
    const targetPath = join(temporaryDirectory, "2025/data.yaml");
    await mkdir(join(temporaryDirectory, "2026"));
    await writeFile(sourcePath, "revision: 1\n", { flush: true });

    await moveTextFileAtomically(
      sourcePath,
      targetPath,
      "revision: 2\n",
      () => {},
    );

    await expect(readFile(sourcePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(targetPath, "utf8")).resolves.toBe("revision: 2\n");
  });

  it("移動先が存在する場合は元と移動先を変更しない", async () => {
    const sourcePath = join(temporaryDirectory, "source.yaml");
    const targetPath = join(temporaryDirectory, "target.yaml");
    await Promise.all([
      writeFile(sourcePath, "source\n"),
      writeFile(targetPath, "target\n"),
    ]);

    await expect(
      moveTextFileAtomically(sourcePath, targetPath, "updated\n", () => {}),
    ).rejects.toThrow("既に存在します");
    await expect(readFile(sourcePath, "utf8")).resolves.toBe("source\n");
    await expect(readFile(targetPath, "utf8")).resolves.toBe("target\n");
  });
});
