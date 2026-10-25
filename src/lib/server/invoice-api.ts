import { json } from "@sveltejs/kit";
import { z } from "zod";

import {
  createInvoiceDraft,
  type InvoiceCreationGateway,
} from "../application/create-invoice-draft";
import { DomainValidationError } from "../domain/domain-validation-error";
import { DataDirectoryConfigurationError } from "./data-directory";
import { KeiriDataLoadError } from "./keiri-data-loader";

const createInvoiceRequestSchema = z.strictObject({
  businessPartnerCode: z.string().min(1),
  paymentDueDate: z.string().min(1),
  issueDate: z.string().min(1).optional(),
});

export interface CreateInvoiceApiDependencies {
  gateway: InvoiceCreationGateway;
  today: string;
}

export async function handleCreateInvoiceRequest(
  request: Request,
  requestUrl: URL,
  dependencies: CreateInvoiceApiDependencies,
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

  const parsed = createInvoiceRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        message: "請求書の作成内容が不正です。",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const result = await createInvoiceDraft(dependencies.gateway, {
      ...parsed.data,
      today: dependencies.today,
    });
    return json(result, { status: 201 });
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
