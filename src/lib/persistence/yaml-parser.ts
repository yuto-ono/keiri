import BigNumber from "bignumber.js";
import { isScalar, LineCounter, parseDocument, visit } from "yaml";
import type { z } from "zod";

import {
  DataValidationError,
  type DataValidationIssue,
} from "./data-validation-error";

export function parseYaml<T>(
  source: string,
  filePath: string,
  schema: z.ZodType<T>,
): T {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, {
    schema: "core",
    merge: false,
    uniqueKeys: true,
    strict: true,
    prettyErrors: true,
    keepSourceTokens: true,
    lineCounter,
    resolveKnownTags: false,
  });
  const issues: DataValidationIssue[] = [
    ...document.errors.map((error) => ({
      message: error.message,
      line: error.linePos?.[0].line,
      column: error.linePos?.[0].col,
      path: [],
    })),
    ...document.warnings.map((warning) => ({
      message: warning.message,
      line: warning.linePos?.[0].line,
      column: warning.linePos?.[0].col,
      path: [],
    })),
  ];

  if (document.directives.docStart) {
    issues.push({
      path: [],
      line: 1,
      column: 1,
      message: "ドキュメント開始記号 --- は使用できません。",
    });
  }
  if (document.directives.docEnd) {
    const offset = source.lastIndexOf("...");
    issues.push({
      path: [],
      ...positionAt(offset, lineCounter),
      message: "ドキュメント終了記号 ... は使用できません。",
    });
  }

  visit(document, {
    Alias(_key, node) {
      issues.push({
        path: [],
        ...positionAt(node.range?.[0], lineCounter),
        message: "YAMLのエイリアスは使用できません。",
      });
    },
    Node(_key, node) {
      if (node.anchor !== undefined) {
        issues.push({
          path: [],
          ...positionAt(node.range?.[0], lineCounter),
          message: "YAMLのアンカーは使用できません。",
        });
      }
      if (node.tag !== undefined) {
        issues.push({
          path: [],
          ...positionAt(node.range?.[0], lineCounter),
          message: "YAMLの明示的な型タグは使用できません。",
        });
      }
      if (!isScalar(node) || typeof node.value !== "number") {
        return;
      }

      const position = positionAt(node.range?.[0], lineCounter);
      if (!Number.isFinite(node.value)) {
        issues.push({
          path: [],
          ...position,
          message: "有限でない数値は使用できません。",
        });
        return;
      }

      if (Number.isInteger(node.value) && !Number.isSafeInteger(node.value)) {
        issues.push({
          path: [],
          ...position,
          message: "JavaScriptで安全に扱えない整数は使用できません。",
        });
        return;
      }

      if (
        node.source !== undefined &&
        hasLostNumericPrecision(node.source, node.value)
      ) {
        issues.push({
          path: [],
          ...position,
          message:
            "JavaScriptのnumberへ変換すると精度が失われる数値は使用できません。",
        });
      }
    },
    Pair(_key, pair) {
      if (isScalar(pair.key) && pair.key.value === "<<") {
        issues.push({
          path: [],
          ...positionAt(pair.key.range?.[0], lineCounter),
          message: "YAMLのマージキーは使用できません。",
        });
      }
    },
  });

  if (issues.length > 0) {
    throw new DataValidationError(filePath, issues);
  }

  const parsed = schema.safeParse(document.toJS({ maxAliasCount: 0 }));
  if (!parsed.success) {
    throw new DataValidationError(
      filePath,
      parsed.error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    );
  }

  return parsed.data;
}

function hasLostNumericPrecision(source: string, value: number): boolean {
  try {
    return !new BigNumber(source).isEqualTo(new BigNumber(value.toString()));
  } catch {
    return false;
  }
}

function positionAt(
  offset: number | undefined,
  lineCounter: LineCounter,
): { line?: number; column?: number } {
  if (offset === undefined || offset < 0) {
    return {};
  }

  const position = lineCounter.linePos(offset);
  return { line: position.line, column: position.col };
}
