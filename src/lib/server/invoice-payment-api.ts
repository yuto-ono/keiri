import { json } from "@sveltejs/kit";
import { z } from "zod";

import {
  deleteInvoicePaymentCompletedDate,
  setInvoicePaymentCompletedDate,
  type InvoicePaymentGateway,
  type InvoicePaymentResult,
} from "#lib/application/manage-invoice-payment";
import { DomainValidationError } from "#lib/domain/domain-validation-error";
import { DataDirectoryConfigurationError } from "#lib/server/data-directory";
import { KeiriDataLoadError } from "#lib/server/keiri-data-loader";

const revisionRequestSchema = z.strictObject({
  revision: z
    .int("1以上の安全な整数が必要です。")
    .positive("1以上の安全な整数が必要です。"),
});
const setPaymentRequestSchema = revisionRequestSchema.extend({
  paymentCompletedDate: z.string().min(1, "入金完了日は必須です。"),
});

export interface InvoicePaymentApiDependencies {
  gateway: InvoicePaymentGateway;
}

export interface SetInvoicePaymentApiDependencies extends InvoicePaymentApiDependencies {
  today: string;
}

export async function handleSetInvoicePaymentCompletedDateRequest(
  request: Request,
  requestUrl: URL,
  invoiceNumber: string,
  dependencies: SetInvoicePaymentApiDependencies,
): Promise<Response> {
  return handlePaymentRequest(
    request,
    requestUrl,
    setPaymentRequestSchema,
    (input) =>
      setInvoicePaymentCompletedDate(dependencies.gateway, {
        invoiceNumber,
        expectedRevision: input.revision,
        paymentCompletedDate: input.paymentCompletedDate,
        today: dependencies.today,
      }),
  );
}

export async function handleDeleteInvoicePaymentCompletedDateRequest(
  request: Request,
  requestUrl: URL,
  invoiceNumber: string,
  dependencies: InvoicePaymentApiDependencies,
): Promise<Response> {
  return handlePaymentRequest(
    request,
    requestUrl,
    revisionRequestSchema,
    (input) =>
      deleteInvoicePaymentCompletedDate(dependencies.gateway, {
        invoiceNumber,
        expectedRevision: input.revision,
      }),
  );
}

async function handlePaymentRequest<T>(
  request: Request,
  requestUrl: URL,
  schema: z.ZodType<T>,
  execute: (input: T) => Promise<InvoicePaymentResult>,
): Promise<Response> {
  if (request.headers.get("origin") !== requestUrl.origin) {
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
        message: "入金完了日の変更内容が不正です。",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    return json(await execute(parsed.data));
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
