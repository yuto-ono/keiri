import { isBusinessDateAfter } from "#lib/domain/business-date";
import { validateBusinessPartnerIssuerDisplay } from "#lib/domain/business-partner";
import type {
  BusinessPartner,
  Invoice,
  Issuer,
  TaxCategories,
  TaxCategory,
} from "#lib/domain/model";

export interface DataFile<T> {
  filePath: string;
  data: T;
}

export interface KeiriDataSet {
  businessPartners: readonly DataFile<BusinessPartner>[];
  issuers: readonly DataFile<Issuer>[];
  taxCategories: DataFile<TaxCategories>;
  invoices: readonly DataFile<Invoice>[];
}

export interface DataIntegrityIssue {
  filePath: string;
  path: readonly PropertyKey[];
  message: string;
}

export function validateDataIntegrity(
  dataSet: KeiriDataSet,
): DataIntegrityIssue[] {
  const issues: DataIntegrityIssue[] = [];

  if (dataSet.issuers.length !== 1) {
    issues.push({
      filePath: "issuers",
      path: [],
      message: `初期版の発行者は1件必要ですが、${dataSet.issuers.length}件あります。`,
    });
  }

  validateUniqueValues(
    dataSet.businessPartners,
    (partner: BusinessPartner) => partner.code,
    ["code"],
    "取引先コード",
    issues,
  );
  validateUniqueValues(
    dataSet.invoices,
    (invoice: Invoice) => invoice.invoiceNumber,
    ["invoiceNumber"],
    "請求書番号",
    issues,
  );
  validateUniqueValues(
    dataSet.taxCategories.data.taxCategories.map((data, index) => ({
      filePath: dataSet.taxCategories.filePath,
      data,
      index,
    })),
    (taxCategory: TaxCategory) => taxCategory.id,
    ["taxCategories"],
    "税区分ID",
    issues,
    (record) => ["taxCategories", record.index, "id"],
  );

  const partnersByCode = new Map(
    dataSet.businessPartners.map(({ data }) => [data.code, data]),
  );
  const issuersById = new Map(
    dataSet.issuers.map(({ data }) => [data.id, data]),
  );
  const taxCategoriesById = new Map(
    dataSet.taxCategories.data.taxCategories.map((category) => [
      category.id,
      category,
    ]),
  );

  for (const record of dataSet.issuers) {
    validateIssuer(record, issues);
  }
  for (const record of dataSet.businessPartners) {
    validateBusinessPartner(record, dataSet.issuers, issues);
  }
  for (const record of dataSet.invoices) {
    validateInvoice(
      record,
      partnersByCode,
      issuersById,
      taxCategoriesById,
      issues,
    );
  }

  return issues;
}

function validateIssuer(
  record: DataFile<Issuer>,
  issues: DataIntegrityIssue[],
): void {
  const { data: issuer, filePath } = record;
  expectFilePath(filePath, `issuers/${issuer.id}.yaml`, issues);

  const seenIds = new Map<string, number>();
  issuer.bankAccounts.forEach((account, index) => {
    const normalized = account.id.toLowerCase();
    const firstIndex = seenIds.get(normalized);
    if (firstIndex !== undefined) {
      issues.push({
        filePath,
        path: ["bankAccounts", index, "id"],
        message: `振込先ID ${account.id} は bankAccounts[${firstIndex}] と大文字・小文字を区別せず重複しています。`,
      });
    } else {
      seenIds.set(normalized, index);
    }
  });

  if (
    !issuer.bankAccounts.some(
      (account) => account.id === issuer.defaultBankAccountId,
    )
  ) {
    issues.push({
      filePath,
      path: ["defaultBankAccountId"],
      message: `既定の振込先 ${issuer.defaultBankAccountId} がbankAccountsに存在しません。`,
    });
  }
}

function validateBusinessPartner(
  record: DataFile<BusinessPartner>,
  issuerRecords: readonly DataFile<Issuer>[],
  issues: DataIntegrityIssue[],
): void {
  const { data: partner, filePath } = record;
  expectFilePath(filePath, `business-partners/${partner.code}.yaml`, issues);

  if (issuerRecords.length !== 1) {
    return;
  }

  const issuer = issuerRecords[0].data;
  issues.push(
    ...validateBusinessPartnerIssuerDisplay(partner, issuer).map((issue) => ({
      ...issue,
      filePath,
    })),
  );
}

function validateInvoice(
  record: DataFile<Invoice>,
  partnersByCode: ReadonlyMap<string, BusinessPartner>,
  issuersById: ReadonlyMap<string, Issuer>,
  taxCategoriesById: ReadonlyMap<string, TaxCategory>,
  issues: DataIntegrityIssue[],
): void {
  const { data: invoice, filePath } = record;
  const transactionYear = invoice.transactionDate.slice(0, 4);
  expectFilePath(
    filePath,
    `sales/invoices/${transactionYear}/${invoice.invoiceNumber}.yaml`,
    issues,
  );

  if (!partnersByCode.has(invoice.businessPartner.code)) {
    issues.push({
      filePath,
      path: ["businessPartner", "code"],
      message: `取引先 ${invoice.businessPartner.code} が存在しません。`,
    });
  }
  if (!issuersById.has(invoice.issuer.id)) {
    issues.push({
      filePath,
      path: ["issuer", "id"],
      message: `発行者 ${invoice.issuer.id} が存在しません。`,
    });
  }

  validateInvoiceNumber(invoice, filePath, issues);

  if (isBusinessDateAfter(invoice.issueDate, invoice.paymentDueDate)) {
    issues.push({
      filePath,
      path: ["paymentDueDate"],
      message: "支払期限は発行日以降にしてください。",
    });
  }

  const firstTaxCategoryId = invoice.lineItems[0]?.taxCategoryId;
  invoice.lineItems.forEach((lineItem, index) => {
    const taxCategory = taxCategoriesById.get(lineItem.taxCategoryId);
    if (taxCategory === undefined) {
      issues.push({
        filePath,
        path: ["lineItems", index, "taxCategoryId"],
        message: `税区分 ${lineItem.taxCategoryId} が存在しません。`,
      });
    } else if (
      taxCategory.treatment !== "taxable" ||
      !taxCategory.isStandardRate
    ) {
      issues.push({
        filePath,
        path: ["lineItems", index, "taxCategoryId"],
        message: `初期版では標準税率の課税区分だけを使用できます。`,
      });
    }

    if (lineItem.taxCategoryId !== firstTaxCategoryId) {
      issues.push({
        filePath,
        path: ["lineItems", index, "taxCategoryId"],
        message: "1枚の請求書ではすべての明細に同じ税区分を指定してください。",
      });
    }
  });

  if (invoice.status === "issued") {
    if (invoice.lineItems.length === 0 || invoice.lineItems.length > 10) {
      issues.push({
        filePath,
        path: ["lineItems"],
        message: "発行済み請求書の明細は1件以上10件以下にしてください。",
      });
    }
    if (invoice.issuer.snapshot.bankAccounts.length === 0) {
      issues.push({
        filePath,
        path: ["issuer", "snapshot", "bankAccounts"],
        message: "発行済み請求書には振込先が1件以上必要です。",
      });
    }
  }
}

function validateInvoiceNumber(
  invoice: Invoice,
  filePath: string,
  issues: DataIntegrityIssue[],
): void {
  const escapedCode = invoice.businessPartner.code.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const match = new RegExp(`^${escapedCode}-(\\d{6})-(0[1-9]|[1-9]\\d)$`).exec(
    invoice.invoiceNumber,
  );

  if (match === null) {
    issues.push({
      filePath,
      path: ["invoiceNumber"],
      message: "請求書番号は取引先コード-YYYYMM-2桁連番の形式にしてください。",
    });
    return;
  }

  const issueMonth = invoice.issueDate.slice(0, 7).replace("-", "");
  if (match[1] !== issueMonth) {
    issues.push({
      filePath,
      path: ["invoiceNumber"],
      message: "請求書番号の発行年月がissueDateと一致しません。",
    });
  }
}

function expectFilePath(
  actual: string,
  expected: string,
  issues: DataIntegrityIssue[],
): void {
  if (actual !== expected) {
    issues.push({
      filePath: actual,
      path: [],
      message: `配置先は ${expected} である必要があります。`,
    });
  }
}

function validateUniqueValues<T, R extends DataFile<T>>(
  records: readonly R[],
  valueOf: (value: T) => string,
  defaultPath: readonly PropertyKey[],
  label: string,
  issues: DataIntegrityIssue[],
  pathOf: (record: R) => readonly PropertyKey[] = () => defaultPath,
): void {
  const seen = new Map<string, R>();
  for (const record of records) {
    const value = valueOf(record.data);
    const normalized = value.toLowerCase();
    const first = seen.get(normalized);
    if (first === undefined) {
      seen.set(normalized, record);
      continue;
    }

    issues.push({
      filePath: record.filePath,
      path: pathOf(record),
      message: `${label} ${value} は ${first.filePath} と大文字・小文字を区別せず重複しています。`,
    });
  }
}
