import { z } from "zod";

import type { MonthlyBillingStatus } from "#lib/domain/model";
import {
  DataValidationError,
  type DataValidationIssue,
} from "#lib/persistence/data-validation-error";
import { parseYaml } from "#lib/persistence/yaml-parser";

const frontMatterSchema = z.strictObject(
  {
    status: z.enum(
      ["pending", "completed"],
      "statusには pending または completed を指定してください。",
    ),
  },
  "Front Matterにはstatusだけを持つオブジェクトを指定してください。",
);

export class MonthlyBillingParseError extends DataValidationError {
  readonly body: string;

  constructor(
    filePath: string,
    issues: readonly DataValidationIssue[],
    body: string,
  ) {
    super(filePath, issues);
    this.name = "MonthlyBillingParseError";
    this.body = body;
  }
}

export function parseMonthlyBilling(
  source: string,
  filePath: string,
): { status: MonthlyBillingStatus; body: string } {
  const lines = source.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? [];
  const lineText = (line: string) => line.replace(/[\r\n]+$/, "");
  const delimiter = /^---[ \t]*$/;
  if (!delimiter.test(lineText(lines[0] ?? "").replace(/^\uFEFF/, ""))) {
    throw new MonthlyBillingParseError(
      filePath,
      [
        {
          path: [],
          line: 1,
          column: 1,
          message: "先頭にFront Matterの開始記号 --- が必要です。",
        },
      ],
      source,
    );
  }
  const end = lines.findIndex(
    (line, index) => index > 0 && delimiter.test(lineText(line)),
  );
  if (end === -1) {
    throw new MonthlyBillingParseError(
      filePath,
      [
        {
          path: [],
          line: 1,
          column: 1,
          message: "Front Matterの終了記号 --- がありません。",
        },
      ],
      source,
    );
  }
  const body = lines.slice(end + 1).join("");
  try {
    const header = parseYaml(
      lines.slice(1, end).join(""),
      filePath,
      frontMatterSchema,
    );
    return { status: header.status, body };
  } catch (error) {
    if (error instanceof DataValidationError) {
      throw new MonthlyBillingParseError(
        filePath,
        error.issues.map((issue) => ({
          ...issue,
          line: issue.line === undefined ? undefined : issue.line + 1,
        })),
        body,
      );
    }
    throw error;
  }
}
