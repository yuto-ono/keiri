import { json } from "@sveltejs/kit";
import { z } from "zod";

import {
  createBusinessPartner,
  deleteBusinessPartner,
  updateBusinessPartner,
  type BusinessPartnerManagementGateway,
} from "#lib/application/manage-business-partners";
import { DomainValidationError } from "#lib/domain/domain-validation-error";
import { businessPartnerSchema } from "#lib/persistence/schemas";
import { DataDirectoryConfigurationError } from "#lib/server/data-directory";
import { KeiriDataLoadError } from "#lib/server/keiri-data-loader";
import { isSameOriginWriteRequest } from "#lib/server/same-origin";

const createRequestSchema = businessPartnerSchema
  .omit({ revision: true })
  .partial({
    issuerDisplay: true,
    pdfFileNamePattern: true,
    billingInstructions: true,
  });
const deleteRequestSchema = z.strictObject({
  revision: z
    .int("1以上の安全な整数が必要です。")
    .positive("1以上の安全な整数が必要です。"),
});

export interface BusinessPartnerApiDependencies {
  gateway: BusinessPartnerManagementGateway;
}

export async function handleCreateBusinessPartnerRequest(
  request: Request,
  url: URL,
  dependencies: BusinessPartnerApiDependencies,
): Promise<Response> {
  return handleRequest(
    request,
    url,
    createRequestSchema,
    (input) => createBusinessPartner(dependencies.gateway, input),
    201,
  );
}

export async function handleUpdateBusinessPartnerRequest(
  request: Request,
  url: URL,
  code: string,
  dependencies: BusinessPartnerApiDependencies,
): Promise<Response> {
  return handleRequest(request, url, businessPartnerSchema, (input) =>
    updateBusinessPartner(dependencies.gateway, code, input),
  );
}

export async function handleDeleteBusinessPartnerRequest(
  request: Request,
  url: URL,
  code: string,
  dependencies: BusinessPartnerApiDependencies,
): Promise<Response> {
  return handleRequest(request, url, deleteRequestSchema, (input) =>
    deleteBusinessPartner(dependencies.gateway, {
      code,
      expectedRevision: input.revision,
    }),
  );
}

async function handleRequest<T, R>(
  request: Request,
  url: URL,
  schema: z.ZodType<T>,
  execute: (input: T) => Promise<R>,
  status = 200,
): Promise<Response> {
  if (!isSameOriginWriteRequest(request, url)) {
    return json(
      { message: "同一オリジン以外からの書き込みは受け付けません。" },
      { status: 403 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      { message: "リクエスト本文をJSONとして解析できません。" },
      { status: 400 },
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        message: "取引先の変更内容が不正です。",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }
  try {
    return json(await execute(parsed.data), { status });
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return json(
        { message: error.message, issues: error.issues },
        { status: 422 },
      );
    }
    if (error instanceof KeiriDataLoadError) {
      return json(
        { message: error.message, issues: error.issues },
        { status: 500 },
      );
    }
    if (error instanceof DataDirectoryConfigurationError) {
      return json({ message: error.message }, { status: 500 });
    }
    throw error;
  }
}
