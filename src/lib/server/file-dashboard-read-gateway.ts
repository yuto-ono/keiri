import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  DashboardReadGateway,
  MonthlyBillingReadResult,
} from "#lib/application/read-dashboard";
import {
  MonthlyBillingParseError,
  parseMonthlyBilling,
} from "#lib/persistence/monthly-billing";
import { FileKeiriReadGateway } from "#lib/server/file-keiri-read-gateway";

export class FileDashboardReadGateway implements DashboardReadGateway {
  readonly #rootDirectory: string;

  constructor(rootDirectory: string) {
    this.#rootDirectory = rootDirectory;
  }

  loadData() {
    return new FileKeiriReadGateway(this.#rootDirectory).loadData();
  }

  async readMonthlyBilling(month: string): Promise<MonthlyBillingReadResult> {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
    if (match === null) {
      throw new RangeError(`月次請求の年月が不正です: ${month}`);
    }
    const filePath = `monthly-billing/${match[1]}/${match[2]}.md`;
    let source: string;
    try {
      source = await readFile(resolve(this.#rootDirectory, filePath), "utf8");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return { kind: "missing", filePath };
      }
      return {
        kind: "error",
        filePath,
        body: "",
        issues: [
          {
            path: [],
            message: `月次請求Markdownを読み込めません: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
    try {
      return {
        kind: "recorded",
        filePath,
        ...parseMonthlyBilling(source, filePath),
      };
    } catch (error) {
      if (error instanceof MonthlyBillingParseError) {
        return {
          kind: "error",
          filePath,
          body: error.body,
          issues: error.issues.map((issue) => ({
            ...issue,
            path: issue.path.map((part) =>
              typeof part === "symbol" ? String(part) : part,
            ),
          })),
        };
      }
      throw error;
    }
  }
}
