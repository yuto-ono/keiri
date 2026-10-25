import BigNumber from "bignumber.js";
import { z } from "zod";

import { isBusinessDate } from "../domain/business-date";
import type {
  BankAccount,
  BusinessPartner,
  Invoice,
  Issuer,
  Settings,
  TaxCategories,
  TaxCategory,
} from "../domain/model";

const nonEmptyString = z.string().min(1, "空でない文字列が必要です。");
const revision = z.int("正の整数が必要です。").positive("正の整数が必要です。");
const identifier = z
  .string()
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?!-))*[A-Za-z0-9]$|^[A-Za-z0-9]$/,
    "半角英数字で始まり終わる半角英数字とハイフンを指定し、ハイフンを連続させないでください。",
  )
  .max(32, "32文字以下にしてください。");
const businessPartnerCode = z
  .string()
  .regex(/^[A-Za-z0-9]{1,12}$/, "1〜12文字の半角英数字を指定してください。");
const businessDate = z
  .string()
  .refine(isBusinessDate, "YYYY-MM-DD形式の有効な日付が必要です。");
const roundingMethod = z.enum(["floor", "halfUp", "ceil"]);
const honorific = z.enum(["様", "御中"]);

export const bankAccountSchema: z.ZodType<BankAccount> = z.strictObject({
  id: identifier,
  bankName: nonEmptyString,
  branchName: nonEmptyString,
  branchCode: z
    .string()
    .regex(/^\d{3}$/, "3桁の半角数字が必要です。")
    .nullable(),
  accountType: z.enum(["ordinary", "checking"]),
  accountNumber: z.string().regex(/^\d{7}$/, "7桁の半角数字が必要です。"),
  accountHolderName: nonEmptyString,
});

export const businessPartnerSchema: z.ZodType<BusinessPartner> = z.strictObject(
  {
    revision,
    code: businessPartnerCode,
    addressee: nonEmptyString,
    honorific,
    requiresMonthlyInvoice: z.boolean(),
    billingInstructions: nonEmptyString.nullable(),
    unitPricesIncludeTax: z.boolean(),
    issuerDisplay: z.strictObject({
      phone: z.boolean(),
      email: z.boolean(),
      bankAccountIds: z
        .array(identifier)
        .min(1, "振込先IDを1件以上指定してください。"),
    }),
    pdfFileNamePattern: nonEmptyString,
  },
);

export const issuerSchema: z.ZodType<Issuer> = z.strictObject({
  revision,
  id: identifier,
  name: nonEmptyString,
  registrationNumber: z
    .string()
    .regex(/^T\d{13}$/, "Tと13桁の半角数字が必要です。"),
  phone: nonEmptyString.nullable(),
  email: nonEmptyString.nullable(),
  bankAccounts: z
    .array(bankAccountSchema)
    .min(1, "振込先を1件以上指定してください。"),
  defaultBankAccountId: identifier,
});

const taxableTaxCategorySchema = z.strictObject({
  id: identifier,
  name: nonEmptyString,
  treatment: z.literal("taxable"),
  deprecated: z.boolean(),
  isStandardRate: z.boolean(),
  ratePercent: z.int().min(1).max(100),
});

const nonTaxableTaxCategorySchema = z.strictObject({
  id: identifier,
  name: nonEmptyString,
  treatment: z.enum(["nonTaxable", "outOfScope", "taxExempt"]),
  deprecated: z.boolean(),
});

export const taxCategorySchema: z.ZodType<TaxCategory> = z.discriminatedUnion(
  "treatment",
  [taxableTaxCategorySchema, nonTaxableTaxCategorySchema],
);

export const taxCategoriesSchema: z.ZodType<TaxCategories> = z.strictObject({
  revision,
  taxCategories: z.array(taxCategorySchema),
});

export const settingsSchema: z.ZodType<Settings> = z.strictObject({
  revision,
  rounding: z.strictObject({
    lineAmount: roundingMethod,
    taxAmount: roundingMethod,
  }),
});

const invoiceLineItemSchema = z.strictObject({
  name: nonEmptyString,
  quantity: z
    .number()
    .positive()
    .max(999_999_999_999.99)
    .refine((value) => {
      const decimalPlaces = new BigNumber(value).decimalPlaces();
      return decimalPlaces !== null && decimalPlaces <= 2;
    }, "小数点以下2桁までにしてください。"),
  unit: nonEmptyString,
  unitPrice: z.int().positive().max(999_999_999_999),
  taxCategoryId: identifier,
});

const issuerContactSnapshotSchema = z.discriminatedUnion("visible", [
  z.strictObject({ visible: z.literal(true), value: nonEmptyString }),
  z.strictObject({ visible: z.literal(false) }),
]);

export const invoiceSchema: z.ZodType<Invoice> = z
  .strictObject({
    revision,
    status: z.enum(["draft", "issued"]),
    invoiceNumber: nonEmptyString,
    businessPartner: z.strictObject({
      code: businessPartnerCode,
      snapshot: z.strictObject({
        addressee: nonEmptyString,
        honorific,
      }),
    }),
    issuer: z.strictObject({
      id: identifier,
      snapshot: z.strictObject({
        name: nonEmptyString,
        registrationNumber: z
          .string()
          .regex(/^T\d{13}$/, "Tと13桁の半角数字が必要です。"),
        phone: issuerContactSnapshotSchema,
        email: issuerContactSnapshotSchema,
        bankAccounts: z.array(bankAccountSchema),
      }),
    }),
    issueDate: businessDate,
    transactionDate: businessDate,
    paymentDueDate: businessDate,
    paymentCompletedDate: businessDate.nullable(),
    unitPricesIncludeTax: z.boolean(),
    lineItems: z.array(invoiceLineItemSchema),
    notes: z.string().nullable(),
    rounding: z.strictObject({
      lineAmount: roundingMethod,
      taxAmount: roundingMethod,
    }),
    pdf: z.strictObject({
      fileNameOverride: z.string().nullable(),
      issuedFileName: z.string().nullable(),
    }),
  })
  .superRefine((invoice, context) => {
    if (invoice.status === "draft") {
      if (invoice.paymentCompletedDate !== null) {
        context.addIssue({
          code: "custom",
          path: ["paymentCompletedDate"],
          message: "下書きでは入金完了日をnullにしてください。",
        });
      }
      if (invoice.pdf.issuedFileName !== null) {
        context.addIssue({
          code: "custom",
          path: ["pdf", "issuedFileName"],
          message: "下書きでは発行済みPDFファイル名をnullにしてください。",
        });
      }
    } else if (
      invoice.pdf.issuedFileName === null ||
      !invoice.pdf.issuedFileName.endsWith(".pdf")
    ) {
      context.addIssue({
        code: "custom",
        path: ["pdf", "issuedFileName"],
        message: "発行済み請求書には.pdfで終わるファイル名が必要です。",
      });
    }
  });
