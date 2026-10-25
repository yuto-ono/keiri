import js from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import ts from "typescript-eslint";

const frameworkAndRuntime = {
  group: [
    "svelte",
    "svelte/*",
    "$app",
    "$app/*",
    "$env",
    "$env/*",
    "node:*",
    "fs",
    "fs/*",
    "path",
    "path/*",
    "url",
    "url/*",
  ],
  message:
    "中核層をSvelte・SvelteKit・Node.jsの実行環境から独立させてください。",
};

const layerBoundaries = ts.config(
  {
    files: ["src/lib/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/application/**",
                "**/persistence/**",
                "**/server/**",
                "**/cli/**",
                "**/ui/**",
                "yaml",
              ],
              message:
                "domain/には業務規則だけを置き、外側の層やYAMLへ依存させないでください。",
            },
            frameworkAndRuntime,
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/application/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/persistence/**",
                "**/server/**",
                "**/cli/**",
                "**/ui/**",
                "yaml",
              ],
              message:
                "application/は外部I/Oを境界から受け取り、永続化形式や入口へ依存させないでください。",
            },
            frameworkAndRuntime,
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/persistence/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/server/**", "**/cli/**", "**/ui/**"],
              message:
                "persistence/はデータ形式だけを扱い、I/Oや入口へ依存させないでください。",
            },
            frameworkAndRuntime,
          ],
        },
      ],
    },
  },
);

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts"],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
        extraFileExtensions: [".svelte"],
      },
    },
  },
  ...layerBoundaries,
  {
    ignores: ["build/", ".svelte-kit/", "coverage/", "node_modules/"],
  },
);
