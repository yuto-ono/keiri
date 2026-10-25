export interface DomainValidationIssue {
  path: readonly (string | number)[];
  message: string;
}

export class DomainValidationError extends Error {
  readonly issues: readonly DomainValidationIssue[];

  constructor(message: string, issues: readonly DomainValidationIssue[]) {
    super(message);
    this.name = "DomainValidationError";
    this.issues = issues;
  }
}
