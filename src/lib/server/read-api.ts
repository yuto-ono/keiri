import { json } from "@sveltejs/kit";
import {
  getDashboard,
  type DashboardReadGateway,
} from "#lib/application/read-dashboard";

import {
  getBusinessPartner,
  getInvoice,
  getInvoiceCreationData,
  getInvoicePdf,
  getIssuer,
  getSettings,
  listBusinessPartners,
  listInvoices,
  listIssuers,
  type KeiriReadGateway,
} from "#lib/application/read-keiri-data";
import { todayInTokyo } from "#lib/domain/business-date";
import { DomainValidationError } from "#lib/domain/domain-validation-error";
import {
  DataDirectoryConfigurationError,
  resolveKeiriDataDirectory,
} from "#lib/server/data-directory";
import { FileKeiriReadGateway } from "#lib/server/file-keiri-read-gateway";
import { FileDashboardReadGateway } from "#lib/server/file-dashboard-read-gateway";
import { KeiriDataLoadError } from "#lib/server/keiri-data-loader";

export interface ReadApiDependencies {
  gateway: KeiriReadGateway;
  today?: string;
}

export function handleGetDashboardRequest(dependencies?: {
  gateway: DashboardReadGateway;
  today?: string;
}): Promise<Response> {
  return handleJsonRead(() =>
    getDashboard(
      dependencies?.gateway ??
        new FileDashboardReadGateway(resolveKeiriDataDirectory(process.cwd())),
      dependencies?.today ?? todayInTokyo(),
    ),
  );
}

export async function handleListInvoicesRequest(
  url: URL,
  dependencies?: ReadApiDependencies,
): Promise<Response> {
  const values = url.searchParams.getAll("year");
  if (
    values.length > 1 ||
    (values[0] !== undefined && !/^\d{4}$/.test(values[0]))
  ) {
    return jsonReadResponse(
      {
        message: "取引年を4桁の数字で1つ指定してください。",
        issues: [{ path: ["year"], message: "取引年が不正です。" }],
      },
      400,
    );
  }
  return handleJsonRead(() =>
    listInvoices(gatewayFor(dependencies), {
      year: values[0],
      today: dependencies?.today ?? todayInTokyo(),
    }),
  );
}

export function handleGetInvoiceRequest(
  invoiceNumber: string,
  dependencies?: ReadApiDependencies,
): Promise<Response> {
  return handleJsonRead(async () => {
    const detail = await getInvoice(gatewayFor(dependencies), invoiceNumber);
    return detail === undefined
      ? undefined
      : { ...detail, today: dependencies?.today ?? todayInTokyo() };
  }, `請求書 ${invoiceNumber} が存在しません。`);
}

export function handleGetInvoiceCreationDataRequest(
  sourceInvoiceNumber?: string,
  dependencies?: ReadApiDependencies,
): Promise<Response> {
  return handleJsonRead(async () => {
    const context = await getInvoiceCreationData(
      gatewayFor(dependencies),
      sourceInvoiceNumber,
    );
    return context === undefined
      ? undefined
      : { ...context, today: dependencies?.today ?? todayInTokyo() };
  }, `複製元の請求書 ${sourceInvoiceNumber} が存在しません。`);
}

export function handleListBusinessPartnersRequest(
  dependencies?: ReadApiDependencies,
): Promise<Response> {
  return handleJsonRead(() => listBusinessPartners(gatewayFor(dependencies)));
}

export function handleGetBusinessPartnerRequest(
  code: string,
  dependencies?: ReadApiDependencies,
): Promise<Response> {
  return handleJsonRead(
    () => getBusinessPartner(gatewayFor(dependencies), code),
    `取引先 ${code} が存在しません。`,
  );
}

export function handleListIssuersRequest(
  dependencies?: ReadApiDependencies,
): Promise<Response> {
  return handleJsonRead(() => listIssuers(gatewayFor(dependencies)));
}

export function handleGetIssuerRequest(
  id: string,
  dependencies?: ReadApiDependencies,
): Promise<Response> {
  return handleJsonRead(
    () => getIssuer(gatewayFor(dependencies), id),
    `発行者 ${id} が存在しません。`,
  );
}

export function handleGetSettingsRequest(
  dependencies?: ReadApiDependencies,
): Promise<Response> {
  return handleJsonRead(() => getSettings(gatewayFor(dependencies)));
}

export function handleGetInvoicePdfRequest(
  invoiceNumber: string,
  dependencies?: ReadApiDependencies,
): Promise<Response> {
  return handleRead(async () => {
    const pdf = await getInvoicePdf(gatewayFor(dependencies), invoiceNumber);
    if (pdf === undefined) {
      return jsonReadResponse(
        { message: `請求書 ${invoiceNumber} の正式PDFが存在しません。` },
        404,
      );
    }
    const encodedName = encodeURIComponent(pdf.fileName).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return new Response(new Uint8Array(pdf.contents), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename*=UTF-8''${encodedName}`,
        "cache-control": "no-store",
      },
    });
  });
}

function gatewayFor(dependencies?: ReadApiDependencies): KeiriReadGateway {
  return (
    dependencies?.gateway ??
    new FileKeiriReadGateway(resolveKeiriDataDirectory(process.cwd()))
  );
}

function handleJsonRead<T>(
  load: () => Promise<T | undefined>,
  notFoundMessage = "対象データが存在しません。",
): Promise<Response> {
  return handleRead(async () => {
    const value = await load();
    return value === undefined
      ? jsonReadResponse({ message: notFoundMessage }, 404)
      : jsonReadResponse(value);
  });
}

async function handleRead(execute: () => Promise<Response>): Promise<Response> {
  try {
    return await execute();
  } catch (error) {
    if (
      error instanceof KeiriDataLoadError ||
      error instanceof DomainValidationError
    ) {
      return jsonReadResponse(
        { message: error.message, issues: error.issues },
        500,
      );
    }
    if (error instanceof DataDirectoryConfigurationError) {
      return jsonReadResponse({ message: error.message }, 500);
    }
    throw error;
  }
}

function jsonReadResponse(value: unknown, status = 200): Response {
  return json(value, { status, headers: { "cache-control": "no-store" } });
}
