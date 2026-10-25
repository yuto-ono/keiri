import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const entrypoint = fileURLToPath(new URL("../../cli.ts", import.meta.url));
let workingDirectory: string;

beforeEach(async () => {
  workingDirectory = await mkdtemp(join(tmpdir(), "keiri-cli-"));
  await writeFile(join(workingDirectory, ".env"), "KEIRI_DATA_DIR=./data\n");
});

afterEach(async () => {
  await rm(workingDirectory, { recursive: true, force: true });
});

describe("CLIの起動", () => {
  it.each([
    { command: "issue", description: "正式PDF" },
    { command: "revert-to-draft", description: "正式PDF" },
    { command: "delete", description: "完全に削除" },
  ])(
    "Node.js標準の環境ファイル読み込みで $command のヘルプを表示する",
    ({ command, description }) => {
      const result = spawnSync(
        process.execPath,
        ["--env-file=.env", entrypoint, "invoice", command, "--help"],
        { cwd: workingDirectory, encoding: "utf8", timeout: 10_000 },
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("--revision <期待リビジョン>");
      expect(result.stdout).toContain(description);
      expect(result.stderr).toBe("");
    },
  );

  it("不正な期待リビジョンを標準エラーと非ゼロ終了コードで拒否する", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--env-file=.env",
        entrypoint,
        "invoice",
        "issue",
        "ACME-202610-01",
        "--revision",
        "invalid",
      ],
      { cwd: workingDirectory, encoding: "utf8", timeout: 10_000 },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--revision");
    expect(result.stderr).toContain("1以上の安全な整数");
  });
});
