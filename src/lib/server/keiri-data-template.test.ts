import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DataValidationError } from "../persistence/data-validation-error";
import {
  issuerSchema,
  settingsSchema,
  taxCategoriesSchema,
} from "../persistence/schemas";
import { parseYaml } from "../persistence/yaml-parser";

const templateRoot = resolve(process.cwd(), "templates/keiri-data");

describe("keiri-data雛形", () => {
  it("利用可能な設定と税区分を含む", async () => {
    const [settings, taxCategories] = await Promise.all([
      readFile(resolve(templateRoot, "settings.yaml"), "utf8"),
      readFile(resolve(templateRoot, "tax-categories.yaml"), "utf8"),
    ]);

    expect(parseYaml(settings, "settings.yaml", settingsSchema)).toEqual({
      revision: 1,
      rounding: { lineAmount: "floor", taxAmount: "floor" },
    });
    expect(
      parseYaml(taxCategories, "tax-categories.yaml", taxCategoriesSchema)
        .taxCategories,
    ).toHaveLength(1);
  });

  it("発行者の置換用プレースホルダーは検証に通らない", async () => {
    const source = await readFile(
      resolve(templateRoot, "issuers/your-issuer-id.yaml"),
      "utf8",
    );
    expect(() =>
      parseYaml(source, "issuers/your-issuer-id.yaml", issuerSchema),
    ).toThrow(DataValidationError);
  });

  it("実在する取引先や月次請求ファイルを含まない", async () => {
    const [partners, monthlyBilling] = await Promise.all([
      readdir(resolve(templateRoot, "business-partners")),
      readdir(resolve(templateRoot, "monthly-billing")),
    ]);
    expect(partners.filter((name) => name.endsWith(".yaml"))).toEqual([]);
    expect(monthlyBilling.filter((name) => name.endsWith(".md"))).toEqual([]);
  });
});
