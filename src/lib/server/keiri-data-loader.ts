import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { Settings } from "#lib/domain/model";
import {
  type DataFile,
  type DataIntegrityIssue,
  type KeiriDataSet,
  validateDataIntegrity,
} from "#lib/persistence/data-integrity";
import { DataValidationError } from "#lib/persistence/data-validation-error";
import {
  businessPartnerSchema,
  invoiceSchema,
  issuerSchema,
  settingsSchema,
  taxCategoriesSchema,
} from "#lib/persistence/schemas";
import { parseYaml } from "#lib/persistence/yaml-parser";

export interface LoadedKeiriData extends KeiriDataSet {
  rootDirectory: string;
  settings: DataFile<Settings>;
}

export class KeiriDataLoadError extends Error {
  readonly issues: readonly DataIntegrityIssue[];

  constructor(issues: readonly DataIntegrityIssue[]) {
    super("keiri-dataの検証に失敗しました。");
    this.name = "KeiriDataLoadError";
    this.issues = issues;
  }
}

export async function loadKeiriData(
  rootDirectory: string,
): Promise<LoadedKeiriData> {
  const issues: DataIntegrityIssue[] = [];
  const [settings, taxCategories, businessPartners, issuers, invoices] =
    await Promise.all([
      readYamlFile(rootDirectory, "settings.yaml", settingsSchema, issues),
      readYamlFile(
        rootDirectory,
        "tax-categories.yaml",
        taxCategoriesSchema,
        issues,
      ),
      readYamlDirectory(
        rootDirectory,
        "business-partners",
        businessPartnerSchema,
        issues,
      ),
      readYamlDirectory(rootDirectory, "issuers", issuerSchema, issues),
      readInvoiceDirectory(rootDirectory, issues),
      requireDirectory(rootDirectory, "documents", issues),
      requireDirectory(rootDirectory, "monthly-billing", issues),
    ]);

  let dataSet: KeiriDataSet | undefined;
  if (taxCategories !== undefined) {
    dataSet = {
      taxCategories,
      businessPartners,
      issuers,
      invoices,
    };
    issues.push(...validateDataIntegrity(dataSet));
    await validateIssuedPdfFiles(rootDirectory, invoices, issues);
  }

  if (issues.length === 0 && settings !== undefined && dataSet !== undefined) {
    return { rootDirectory, settings, ...dataSet };
  }

  throw new KeiriDataLoadError(issues);
}

async function readInvoiceDirectory(
  rootDirectory: string,
  issues: DataIntegrityIssue[],
) {
  const basePath = "sales/invoices";
  const entries = await readDirectory(rootDirectory, basePath, issues);
  const years = entries
    .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const records = await Promise.all(
    years.map((year) =>
      readYamlDirectory(
        rootDirectory,
        `${basePath}/${year}`,
        invoiceSchema,
        issues,
      ),
    ),
  );
  return records.flat();
}

async function readYamlDirectory<T>(
  rootDirectory: string,
  relativeDirectory: string,
  schema: Parameters<typeof parseYaml<T>>[2],
  issues: DataIntegrityIssue[],
): Promise<DataFile<T>[]> {
  const entries = await readDirectory(rootDirectory, relativeDirectory, issues);
  const filePaths = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .map((entry) => `${relativeDirectory}/${entry.name}`)
    .sort();
  const records = await Promise.all(
    filePaths.map((filePath) =>
      readYamlFile(rootDirectory, filePath, schema, issues),
    ),
  );
  return records.filter(
    (record): record is DataFile<T> => record !== undefined,
  );
}

async function readYamlFile<T>(
  rootDirectory: string,
  relativePath: string,
  schema: Parameters<typeof parseYaml<T>>[2],
  issues: DataIntegrityIssue[],
): Promise<DataFile<T> | undefined> {
  try {
    const source = await readFile(resolve(rootDirectory, relativePath), "utf8");
    return {
      filePath: relativePath,
      data: parseYaml(source, relativePath, schema),
    };
  } catch (error) {
    if (error instanceof DataValidationError) {
      issues.push(
        ...error.issues.map((issue) => ({
          filePath: error.filePath,
          path: issue.path,
          message: withPosition(issue.message, issue.line, issue.column),
        })),
      );
    } else {
      issues.push({
        filePath: relativePath,
        path: [],
        message: describeFileError(error),
      });
    }
    return undefined;
  }
}

async function readDirectory(
  rootDirectory: string,
  relativePath: string,
  issues: DataIntegrityIssue[],
) {
  try {
    return await readdir(resolve(rootDirectory, relativePath), {
      withFileTypes: true,
    });
  } catch (error) {
    issues.push({
      filePath: relativePath,
      path: [],
      message: describeFileError(error),
    });
    return [];
  }
}

async function requireDirectory(
  rootDirectory: string,
  relativePath: string,
  issues: DataIntegrityIssue[],
): Promise<void> {
  try {
    const information = await stat(resolve(rootDirectory, relativePath));
    if (!information.isDirectory()) {
      issues.push({
        filePath: relativePath,
        path: [],
        message: "ディレクトリではありません。",
      });
    }
  } catch (error) {
    issues.push({
      filePath: relativePath,
      path: [],
      message: describeFileError(error),
    });
  }
}

async function validateIssuedPdfFiles(
  rootDirectory: string,
  invoices: LoadedKeiriData["invoices"],
  issues: DataIntegrityIssue[],
): Promise<void> {
  await Promise.all(
    invoices.map(async ({ filePath, data: invoice }) => {
      if (invoice.status !== "issued" || invoice.pdf.issuedFileName === null) {
        return;
      }

      const pdfPath = [
        "documents",
        invoice.transactionDate.slice(0, 4),
        "sales",
        "invoices",
        invoice.businessPartner.code,
        invoice.pdf.issuedFileName,
      ].join("/");
      try {
        const information = await stat(resolve(rootDirectory, pdfPath));
        if (!information.isFile()) {
          throw new Error("ファイルではありません。");
        }
      } catch (error) {
        issues.push({
          filePath,
          path: ["pdf", "issuedFileName"],
          message: `正式PDF ${pdfPath} を確認できません: ${describeFileError(error)}`,
        });
      }
    }),
  );
}

function withPosition(message: string, line?: number, column?: number): string {
  return line === undefined || column === undefined
    ? message
    : `${line}行${column}列: ${message}`;
}

function describeFileError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
