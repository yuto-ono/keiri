export interface DataValidationIssue {
  path: readonly PropertyKey[];
  message: string;
  line?: number;
  column?: number;
}

export class DataValidationError extends Error {
  readonly filePath: string;
  readonly issues: readonly DataValidationIssue[];

  constructor(filePath: string, issues: readonly DataValidationIssue[]) {
    super(`${filePath} の読み込みに失敗しました。`);
    this.name = "DataValidationError";
    this.filePath = filePath;
    this.issues = issues;
  }
}
