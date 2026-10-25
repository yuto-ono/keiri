import {
  DomainValidationError,
  type DomainValidationIssue,
} from "./domain-validation-error";

const PLACEHOLDER = /\{([^{}]+)\}/g;

export interface PdfFileNameValues {
  businessPartnerCode: string;
  addressee: string;
  honorific: string;
  issueDate: string;
  sequence: number;
}

export function buildPdfFileName(
  pattern: string,
  override: string | null,
  values: PdfFileNameValues,
): string {
  const baseName = override ?? interpolatePdfFileNamePattern(pattern, values);
  const issues = validatePdfBaseName(
    baseName,
    override === null ? ["pdfFileNamePattern"] : ["pdf", "fileNameOverride"],
    override === null
      ? inferPatternValueOrigin(pattern, values, baseName)
      : "請求書単位の個別指定",
  );
  if (issues.length > 0) {
    throw new DomainValidationError("PDFファイル名が不正です。", issues);
  }
  return `${baseName}.pdf`;
}

export function validatePdfFileNamePattern(
  pattern: string,
): DomainValidationIssue[] {
  try {
    buildPdfFileName(pattern, null, {
      businessPartnerCode: "PARTNER",
      addressee: "宛名",
      honorific: "御中",
      issueDate: "2000-01-02",
      sequence: 1,
    });
    return [];
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return [...error.issues];
    }
    throw error;
  }
}

export function validatePdfBaseName(
  baseName: string,
  path: readonly (string | number)[] = ["pdf", "fileNameOverride"],
  origin?: string,
): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];
  if (baseName === "" || baseName === "." || baseName === "..") {
    issues.push({
      path,
      message: `PDFのベース名を空、.、..にはできません。${describeOrigin(origin)}`,
    });
  }

  const invalidCharacter = findInvalidCharacter(baseName);
  if (invalidCharacter !== undefined) {
    issues.push({
      path,
      message: `PDFのベース名に使用できない文字 ${describeCharacter(invalidCharacter)} が含まれています。${describeOrigin(origin)}`,
    });
  }
  return issues;
}

export function isValidIssuedPdfFileName(value: string): boolean {
  if (!value.endsWith(".pdf")) {
    return false;
  }
  return validatePdfBaseName(value.slice(0, -4)).length === 0;
}

function interpolatePdfFileNamePattern(
  pattern: string,
  values: PdfFileNameValues,
): string {
  let invalidPlaceholder: string | undefined;
  const result = pattern.replace(PLACEHOLDER, (_match, placeholder: string) => {
    switch (placeholder) {
      case "businessPartnerCode":
        return values.businessPartnerCode;
      case "addresseeWithHonorific":
        return `${values.addressee}${values.honorific}`;
      case "sequence":
        return String(values.sequence).padStart(2, "0");
      default:
        if (placeholder.startsWith("issueDate:")) {
          const format = placeholder.slice("issueDate:".length);
          const formatted = formatIssueDate(values.issueDate, format);
          if (formatted !== null) {
            return formatted;
          }
        }
        invalidPlaceholder = placeholder;
        return "";
    }
  });

  if (invalidPlaceholder !== undefined || /[{}]/.test(result)) {
    throw new DomainValidationError("PDFファイル名の命名規則が不正です。", [
      {
        path: ["pdfFileNamePattern"],
        message:
          invalidPlaceholder === undefined
            ? "対応していない波括弧が含まれています。"
            : `対応していない差し込み {${invalidPlaceholder}} が含まれています。`,
      },
    ]);
  }

  return result;
}

function formatIssueDate(issueDate: string, dateFormat: string): string | null {
  const [year, month, day] = issueDate.split("-");
  let formatted = "";
  let hasToken = false;

  for (let index = 0; index < dateFormat.length;) {
    if (dateFormat.startsWith("YYYY", index)) {
      formatted += year;
      hasToken = true;
      index += 4;
    } else if (dateFormat.startsWith("MM", index)) {
      formatted += month;
      hasToken = true;
      index += 2;
    } else if (dateFormat.startsWith("DD", index)) {
      formatted += day;
      hasToken = true;
      index += 2;
    } else if ("YMD{}".includes(dateFormat[index])) {
      return null;
    } else {
      formatted += dateFormat[index];
      index += 1;
    }
  }

  return hasToken ? formatted : null;
}

function inferPatternValueOrigin(
  pattern: string,
  values: PdfFileNameValues,
  baseName: string,
): string {
  const invalidCharacter = findInvalidCharacter(baseName);
  if (
    invalidCharacter !== undefined &&
    pattern.includes("{addresseeWithHonorific}") &&
    `${values.addressee}${values.honorific}`.includes(invalidCharacter)
  ) {
    return "請求書が保持する宛名と敬称";
  }
  return "取引先のPDFファイル名命名規則";
}

function findInvalidCharacter(value: string): string | undefined {
  return [...value].find((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      character === "/" ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    );
  });
}

function describeCharacter(character: string): string {
  if (character === "/") {
    return "/";
  }
  return `U+${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`;
}

function describeOrigin(origin: string | undefined): string {
  return origin === undefined ? "" : `（由来: ${origin}）`;
}
