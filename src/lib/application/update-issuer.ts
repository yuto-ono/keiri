import { DomainValidationError } from "#lib/domain/domain-validation-error";
import { validateIssuerUpdate } from "#lib/domain/issuer";
import type { BusinessPartner, Issuer } from "#lib/domain/model";

export interface IssuerUpdateContext {
  issuer: Issuer | undefined;
  businessPartners: readonly BusinessPartner[];
}

export interface IssuerUpdateGateway {
  loadUpdateContext(issuerId: string): Promise<IssuerUpdateContext>;
  saveUpdatedIssuer(
    current: Issuer,
    updated: Issuer,
  ): Promise<{ filePath: string }>;
}

export interface UpdateIssuerResult {
  issuer: Issuer;
  filePath: string;
}

export async function updateIssuer(
  gateway: IssuerUpdateGateway,
  issuerId: string,
  proposed: Issuer,
): Promise<UpdateIssuerResult> {
  const context = await gateway.loadUpdateContext(issuerId);
  const current = context.issuer;
  if (current === undefined) {
    throw new DomainValidationError("発行者を更新できません。", [
      { path: ["id"], message: `発行者 ${issuerId} が存在しません。` },
    ]);
  }
  const issues = validateIssuerUpdate(
    current,
    proposed,
    context.businessPartners,
  );
  if (!Number.isSafeInteger(proposed.revision) || proposed.revision < 1) {
    issues.push({
      path: ["revision"],
      message: "期待リビジョンは1以上の安全な整数にしてください。",
    });
  } else if (proposed.revision !== current.revision) {
    issues.push({
      path: ["revision"],
      message: `期待リビジョン${proposed.revision}は現在のリビジョン${current.revision}と一致しません。`,
    });
  }
  if (issues.length > 0) {
    throw new DomainValidationError("発行者を更新できません。", issues);
  }
  const updated: Issuer = {
    ...proposed,
    revision: current.revision + 1,
    bankAccounts: proposed.bankAccounts.map((account) => ({ ...account })),
  };
  const saved = await gateway.saveUpdatedIssuer(current, updated);
  return { issuer: updated, filePath: saved.filePath };
}
