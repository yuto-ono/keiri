import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDashboard } from "#lib/application/read-dashboard";
import { serializeIssuer } from "#lib/persistence/yaml-serializer";
import { createIssuer } from "#lib/testing/business-partners";
import { FileDashboardReadGateway } from "./file-dashboard-read-gateway";

let dataRoot: string;

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), "keiri-dashboard-"));
  await cp(resolve("templates/keiri-data"), dataRoot, { recursive: true });
  await unlink(join(dataRoot, "issuers/your-issuer-id.yaml"));
  await writeFile(
    join(dataRoot, "issuers/issuer.yaml"),
    serializeIssuer(createIssuer()),
  );
});

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true });
});

describe("月次請求Markdownのファイル読み取り", () => {
  it("年・月のパスから読み、不正な記録は個別の判定エラーとして本文と理由を返す", async () => {
    await mkdir(join(dataRoot, "monthly-billing/2026"));
    const current = "---\r\nstatus: completed\r\n---\r\n完了\r\n";
    const previous = "---\nstatus: 不明\n---\n確認用の本文\n";
    await writeFile(join(dataRoot, "monthly-billing/2026/10.md"), current);
    await writeFile(join(dataRoot, "monthly-billing/2026/09.md"), previous);
    await writeFile(
      join(dataRoot, "monthly-billing/2026/08.md"),
      "過去の不正な記録",
    );
    const before = await readdir(dataRoot, { recursive: true });
    const result = await getDashboard(
      new FileDashboardReadGateway(dataRoot),
      "2026-10-25",
    );
    expect(result.monthlyBilling).toEqual([
      {
        month: "2026-10",
        kind: "recorded",
        filePath: "monthly-billing/2026/10.md",
        status: "completed",
        body: "完了\r\n",
      },
      {
        month: "2026-09",
        kind: "error",
        filePath: "monthly-billing/2026/09.md",
        body: "確認用の本文\n",
        issues: [
          expect.objectContaining({
            path: ["status"],
            message: expect.any(String),
          }),
        ],
      },
    ]);
    expect(
      await readFile(join(dataRoot, "monthly-billing/2026/10.md"), "utf8"),
    ).toBe(current);
    expect(
      await readFile(join(dataRoot, "monthly-billing/2026/09.md"), "utf8"),
    ).toBe(previous);
    expect(await readdir(dataRoot, { recursive: true })).toEqual(before);
  });

  it("年月のディレクトリやファイルがなくても記録なしを返し、作成しない", async () => {
    const gateway = new FileDashboardReadGateway(dataRoot);
    expect(await gateway.readMonthlyBilling("2026-01")).toEqual({
      kind: "missing",
      filePath: "monthly-billing/2026/01.md",
    });
    expect(await readdir(join(dataRoot, "monthly-billing"))).toEqual([
      ".gitkeep",
    ]);
    await mkdir(join(dataRoot, "monthly-billing/2026"));
    expect(await gateway.readMonthlyBilling("2026-10")).toMatchObject({
      kind: "missing",
    });
    expect(await readdir(join(dataRoot, "monthly-billing/2026"))).toEqual([]);
  });

  it("境界が不明なら全文を返し、自動修復しない", async () => {
    await mkdir(join(dataRoot, "monthly-billing/2026"));
    const source = "---\nstatus: completed\n閉じ記号がない本文\n";
    const path = join(dataRoot, "monthly-billing/2026/10.md");
    await writeFile(path, source);
    expect(
      await new FileDashboardReadGateway(dataRoot).readMonthlyBilling(
        "2026-10",
      ),
    ).toMatchObject({
      kind: "error",
      body: source,
      issues: [expect.objectContaining({ line: 1, column: 1 })],
    });
    expect(await readFile(path, "utf8")).toBe(source);
  });

  it("ファイルを読めない場合は記録なしへ読み替えない", async () => {
    await mkdir(join(dataRoot, "monthly-billing/2026/10.md"), {
      recursive: true,
    });
    expect(
      await new FileDashboardReadGateway(dataRoot).readMonthlyBilling(
        "2026-10",
      ),
    ).toMatchObject({
      kind: "error",
      filePath: "monthly-billing/2026/10.md",
      body: "",
      issues: [
        expect.objectContaining({
          message: expect.stringContaining("読み込めません"),
        }),
      ],
    });
  });

  it("不正な必須YAMLは月次記録と区別して通常のデータ取得を拒否する", async () => {
    const invalid = "revision: 1\nrounding: broken\n";
    await writeFile(join(dataRoot, "settings.yaml"), invalid);
    await expect(
      getDashboard(new FileDashboardReadGateway(dataRoot), "2026-10-25"),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ filePath: "settings.yaml" })],
    });
    expect(await readFile(join(dataRoot, "settings.yaml"), "utf8")).toBe(
      invalid,
    );
  });

  it.each([
    "../2026-10",
    "2026-1",
    "2026-00",
    "2026-13",
    "2026-10/../../settings.yaml",
  ])("不正な年月 %s からファイルを探さない", async (month) => {
    await expect(
      new FileDashboardReadGateway(dataRoot).readMonthlyBilling(month),
    ).rejects.toThrow(RangeError);
  });
});
