import { json } from "@sveltejs/kit";
import { z } from "zod";

import {
  createInvoiceDraft,
  type InvoiceCreationGateway,
} from "../application/create-invoice-draft";
import {
  type InvoiceUpdateGateway,
  updateInvoiceDraft,
} from "#lib/application/update-invoice-draft";
import { DomainValidationError } from "../domain/domain-validation-error";
import { duplicateInvoiceDraft } from "#lib/application/duplicate-invoice-draft";
import {
  issueInvoice,
  type InvoiceIssueGateway,
  type InvoicePdfRenderer,
} from "#lib/application/issue-invoice";
import {
  revertInvoiceToDraft,
  type InvoiceRevertToDraftGateway,
} from "#lib/application/revert-invoice-to-draft";
import {
  deleteInvoiceDraft,
  type InvoiceDeletionGateway,
} from "#lib/application/delete-invoice-draft";
import { invoiceSchema } from "#lib/persistence/schemas";
import { DataDirectoryConfigurationError } from "./data-directory";
import { KeiriDataLoadError } from "./keiri-data-loader";

const createInvoiceRequestSchema = z.strictObject({
  businessPartnerCode: z.string().min(1),
  paymentDueDate: z.string().min(1),
  issueDate: z.string().min(1).optional(),
});

const duplicateInvoiceRequestSchema = z.strictObject({
  paymentDueDate: z.string().min(1),
  issueDate: z.string().min(1).optional(),
  businessPartnerCode: z.string().min(1).optional(),
});

const invoiceRevisionRequestSchema = z.strictObject({
  revision: z
    .int("1以上の安全な整数が必要です。")
    .positive("1以上の安全な整数が必要です。"),
});

export interface CreateInvoiceApiDependencies {
  gateway: InvoiceCreationGateway;
  today: string;
}

export interface UpdateInvoiceApiDependencies {
  gateway: InvoiceUpdateGateway;
}

export interface DuplicateInvoiceApiDependencies {
  gateway: InvoiceCreationGateway;
  today: string;
}

export interface IssueInvoiceApiDependencies {
  gateway: InvoiceIssueGateway;
  renderer: InvoicePdfRenderer;
  today: string;
}

export interface RevertInvoiceToDraftApiDependencies {
  gateway: InvoiceRevertToDraftGateway;
}

export interface DeleteInvoiceApiDependencies {
  gateway: InvoiceDeletionGateway;
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

export async function handleUpdateInvoiceRequest(
  request: Request,
  requestUrl: URL,
  invoiceNumber: string,
  dependencies: UpdateInvoiceApiDependencies,
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

  const parsed = invoiceSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        message: "請求書の更新内容が不正です。",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const result = await updateInvoiceDraft(
      dependencies.gateway,
      invoiceNumber,
      parsed.data,
    );
    return json(result);
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

export async function handleDuplicateInvoiceRequest(
  request: Request,
  requestUrl: URL,
  sourceInvoiceNumber: string,
  dependencies: DuplicateInvoiceApiDependencies,
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

  const parsed = duplicateInvoiceRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        message: "請求書の複製条件が不正です。",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const result = await duplicateInvoiceDraft(dependencies.gateway, {
      sourceInvoiceNumber,
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

export async function handleIssueInvoiceRequest(
  request: Request,
  requestUrl: URL,
  invoiceNumber: string,
  dependencies: IssueInvoiceApiDependencies,
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

  const parsed = invoiceRevisionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        message: "請求書の発行条件が不正です。",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const result = await issueInvoice(
      dependencies.gateway,
      dependencies.renderer,
      {
        invoiceNumber,
        expectedRevision: parsed.data.revision,
        today: dependencies.today,
      },
    );
    return json(result);
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

export async function handleRevertInvoiceToDraftRequest(
  request: Request,
  requestUrl: URL,
  invoiceNumber: string,
  dependencies: RevertInvoiceToDraftApiDependencies,
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

  const parsed = invoiceRevisionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        message: "請求書の下書き戻し条件が不正です。",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const result = await revertInvoiceToDraft(dependencies.gateway, {
      invoiceNumber,
      expectedRevision: parsed.data.revision,
    });
    return json(result);
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

export async function handleDeleteInvoiceRequest(
  request: Request,
  requestUrl: URL,
  invoiceNumber: string,
  dependencies: DeleteInvoiceApiDependencies,
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

  const parsed = invoiceRevisionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        message: "請求書の削除条件が不正です。",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const result = await deleteInvoiceDraft(dependencies.gateway, {
      invoiceNumber,
      expectedRevision: parsed.data.revision,
    });
    return json(result);
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
