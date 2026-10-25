import {
  Command,
  CommanderError,
  InvalidArgumentError,
  type Help,
} from "commander";

import {
  createInvoiceDraft,
  type InvoiceCreationGateway,
} from "#lib/application/create-invoice-draft";
import {
  type InvoiceUpdateGateway,
  updateInvoiceDraft,
} from "#lib/application/update-invoice-draft";
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
import { DomainValidationError } from "#lib/domain/domain-validation-error";
import { DataValidationError } from "#lib/persistence/data-validation-error";
import { invoiceSchema } from "#lib/persistence/schemas";
import { parseYaml } from "#lib/persistence/yaml-parser";
import {
  DataDirectoryConfigurationError,
  resolveKeiriDataDirectory,
} from "#lib/server/data-directory";
import { KeiriDataLoadError } from "#lib/server/keiri-data-loader";

export interface CliOutput {
  write(text: string): void;
}

export interface CliDependencies {
  repositoryRoot: string;
  environment: Readonly<Record<string, string | undefined>>;
  today: string;
  createGateway(dataDirectory: string): InvoiceCreationGateway;
  createUpdateGateway(dataDirectory: string): InvoiceUpdateGateway;
  createIssueGateway(dataDirectory: string): InvoiceIssueGateway;
  createRevertToDraftGateway(
    dataDirectory: string,
  ): InvoiceRevertToDraftGateway;
  createPdfRenderer(repositoryRoot: string): InvoicePdfRenderer;
  readInput(path: string): Promise<string>;
}

export interface CliIo {
  stdout: CliOutput;
  stderr: CliOutput;
}

export async function runCli(
  argv: readonly string[],
  dependencies: CliDependencies,
  io: CliIo,
): Promise<number> {
  const program = createProgram(dependencies, io);
  try {
    await program.parseAsync([...argv], { from: "node" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.version"
      ) {
        return 0;
      }
      io.stderr.write(`${translateCommanderError(error)}\n`);
      return error.exitCode || 1;
    }
    if (error instanceof DomainValidationError) {
      writeValidationError(io.stderr, error.message, error.issues);
      return 1;
    }
    if (error instanceof KeiriDataLoadError) {
      writeValidationError(io.stderr, error.message, error.issues);
      return 1;
    }
    if (error instanceof DataValidationError) {
      writeValidationError(io.stderr, error.message, error.issues);
      return 1;
    }
    if (error instanceof DataDirectoryConfigurationError) {
      io.stderr.write(`${error.message}\n`);
      return 1;
    }
    io.stderr.write(
      `処理に失敗しました。\n- 全体: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

function createProgram(dependencies: CliDependencies, io: CliIo): Command {
  const program = new Command()
    .name("pnpm keiri")
    .description("keiriの請求書を操作します。")
    .exitOverride();
  const invoice = program
    .command("invoice")
    .description("請求書を変更します。");
  invoice
    .command("create")
    .description("明細が空の請求書下書きを作成します。")
    .argument("<取引先コード>", "請求書を作成する取引先コード")
    .requiredOption("--payment-due-date <YYYY-MM-DD>", "支払期限")
    .option("--issue-date <YYYY-MM-DD>", "発行日。省略時は実行日")
    .action(
      async (
        businessPartnerCode: string,
        options: { paymentDueDate: string; issueDate?: string },
      ) => {
        const dataDirectory = resolveKeiriDataDirectory(
          dependencies.repositoryRoot,
          dependencies.environment,
        );
        const result = await createInvoiceDraft(
          dependencies.createGateway(dataDirectory),
          {
            businessPartnerCode,
            paymentDueDate: options.paymentDueDate,
            issueDate: options.issueDate,
            today: dependencies.today,
          },
        );
        io.stdout.write(
          [
            "操作結果: 請求書の下書きを作成しました。",
            `請求書番号: ${result.invoice.invoiceNumber}`,
            `YAML保存先: ${result.filePath}`,
            `リビジョン: ${result.invoice.revision}`,
            "",
          ].join("\n"),
        );
      },
    );
  invoice
    .command("update")
    .description("保存済みの請求書下書きを更新します。")
    .argument("<請求書番号>", "更新する請求書番号")
    .requiredOption("--input <ファイルパス|->", "完全な請求書YAMLの入力元")
    .action(async (invoiceNumber: string, options: { input: string }) => {
      const source = await dependencies.readInput(options.input);
      const inputName = options.input === "-" ? "標準入力" : options.input;
      const proposedInvoice = parseYaml(source, inputName, invoiceSchema);
      const dataDirectory = resolveKeiriDataDirectory(
        dependencies.repositoryRoot,
        dependencies.environment,
      );
      const result = await updateInvoiceDraft(
        dependencies.createUpdateGateway(dataDirectory),
        invoiceNumber,
        proposedInvoice,
      );
      io.stdout.write(
        [
          "操作結果: 請求書の下書きを更新しました。",
          `請求書番号: ${result.invoice.invoiceNumber}`,
          `YAML保存先: ${result.filePath}`,
          `リビジョン: ${result.invoice.revision}`,
          "",
        ].join("\n"),
      );
    });
  invoice
    .command("duplicate")
    .description("請求書から新しい独立した下書きを複製します。")
    .argument("<複製元の請求書番号>", "複製元の請求書番号")
    .requiredOption("--payment-due-date <YYYY-MM-DD>", "新しい支払期限")
    .option("--issue-date <YYYY-MM-DD>", "新しい発行日。省略時は実行日")
    .option("--business-partner <取引先コード>", "複製先の取引先")
    .action(
      async (
        sourceInvoiceNumber: string,
        options: {
          paymentDueDate: string;
          issueDate?: string;
          businessPartner?: string;
        },
      ) => {
        const dataDirectory = resolveKeiriDataDirectory(
          dependencies.repositoryRoot,
          dependencies.environment,
        );
        const result = await duplicateInvoiceDraft(
          dependencies.createGateway(dataDirectory),
          {
            sourceInvoiceNumber,
            paymentDueDate: options.paymentDueDate,
            issueDate: options.issueDate,
            businessPartnerCode: options.businessPartner,
            today: dependencies.today,
          },
        );
        io.stdout.write(
          [
            "操作結果: 請求書の下書きを複製しました。",
            `請求書番号: ${result.invoice.invoiceNumber}`,
            `YAML保存先: ${result.filePath}`,
            `リビジョン: ${result.invoice.revision}`,
            "",
          ].join("\n"),
        );
      },
    );

  invoice
    .command("issue")
    .description("保存済みの請求書下書きを発行し、正式PDFを保存します。")
    .argument("<請求書番号>", "発行する請求書番号")
    .requiredOption(
      "--revision <期待リビジョン>",
      "確認済みのリビジョン",
      parseRevision,
    )
    .action(async (invoiceNumber: string, options: { revision: number }) => {
      const dataDirectory = resolveKeiriDataDirectory(
        dependencies.repositoryRoot,
        dependencies.environment,
      );
      const result = await issueInvoice(
        dependencies.createIssueGateway(dataDirectory),
        dependencies.createPdfRenderer(dependencies.repositoryRoot),
        {
          invoiceNumber,
          expectedRevision: options.revision,
          today: dependencies.today,
        },
      );
      io.stdout.write(
        [
          "操作結果: 請求書を発行しました。",
          `請求書番号: ${result.invoice.invoiceNumber}`,
          `YAML保存先: ${result.invoiceFilePath}`,
          `PDF保存先: ${result.pdfFilePath}`,
          `リビジョン: ${result.invoice.revision}`,
          "",
        ].join("\n"),
      );
    });

  invoice
    .command("revert-to-draft")
    .description("発行済み請求書を下書きへ戻し、正式PDFを破棄します。")
    .argument("<請求書番号>", "下書きへ戻す請求書番号")
    .requiredOption(
      "--revision <期待リビジョン>",
      "確認済みのリビジョン",
      parseRevision,
    )
    .action(async (invoiceNumber: string, options: { revision: number }) => {
      const dataDirectory = resolveKeiriDataDirectory(
        dependencies.repositoryRoot,
        dependencies.environment,
      );
      const result = await revertInvoiceToDraft(
        dependencies.createRevertToDraftGateway(dataDirectory),
        { invoiceNumber, expectedRevision: options.revision },
      );
      io.stdout.write(
        [
          "操作結果: 請求書を下書きへ戻しました。",
          `請求書番号: ${result.invoice.invoiceNumber}`,
          `YAML保存先: ${result.invoiceFilePath}`,
          `破棄したPDF: ${result.pdfFilePath}`,
          `リビジョン: ${result.invoice.revision}`,
          "",
        ].join("\n"),
      );
    });

  configureJapaneseOutput(program, io);
  return program;
}

function parseRevision(value: string): number {
  const revision = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(revision) || revision < 1) {
    throw new InvalidArgumentError("1以上の安全な整数を指定してください。");
  }
  return revision;
}

function configureJapaneseOutput(command: Command, io: CliIo): void {
  command
    .helpOption("-h, --help", "ヘルプを表示します。")
    .configureHelp({ formatHelp: formatJapaneseHelp })
    .configureOutput({
      writeOut: (text) => io.stdout.write(text),
      // Commanderの英語エラーはcatch節で日本語へ置き換える。
      writeErr: () => {},
    });
  for (const child of command.commands) {
    configureJapaneseOutput(child, io);
  }
}

function formatJapaneseHelp(command: Command, helper: Help): string {
  const usage = helper
    .commandUsage(command)
    .replace("[options]", "[オプション]")
    .replace("[command]", "[コマンド]");
  const sections = [`使用方法:\n  ${usage}`];
  const description = helper.commandDescription(command);
  if (description) {
    sections.push(`説明:\n  ${description}`);
  }

  const arguments_ = helper.visibleArguments(command);
  if (arguments_.length > 0) {
    sections.push(
      `引数:\n${arguments_
        .map(
          (argument) =>
            `  ${helper.argumentTerm(argument)}  ${helper.argumentDescription(argument)}`,
        )
        .join("\n")}`,
    );
  }

  const commands = helper.visibleCommands(command);
  if (commands.length > 0) {
    sections.push(
      `コマンド:\n${commands
        .map(
          (child) =>
            `  ${helper.subcommandTerm(child)}  ${helper.subcommandDescription(child)}`,
        )
        .join("\n")}`,
    );
  }

  const options = helper.visibleOptions(command);
  if (options.length > 0) {
    sections.push(
      `オプション:\n${options
        .map(
          (option) =>
            `  ${helper.optionTerm(option)}  ${helper.optionDescription(option)}`,
        )
        .join("\n")}`,
    );
  }
  return `${sections.join("\n\n")}\n`;
}

function translateCommanderError(error: CommanderError): string {
  const subject = /'([^']+)'/.exec(error.message)?.[1];
  switch (error.code) {
    case "commander.missingArgument":
      return `必須の引数が指定されていません。${subject === undefined ? "" : `対象: ${subject}`}`;
    case "commander.missingMandatoryOptionValue":
      return `必須のオプションが指定されていません。${subject === undefined ? "" : `対象: ${subject}`}`;
    case "commander.optionMissingArgument":
      return `オプションの値が指定されていません。${subject === undefined ? "" : `対象: ${subject}`}`;
    case "commander.invalidArgument":
      return `オプションの値が不正です。1以上の安全な整数を指定してください。${subject === undefined ? "" : `対象: ${subject}`}`;
    case "commander.unknownCommand":
      return `未対応のコマンドです。${subject === undefined ? "" : `対象: ${subject}`}`;
    case "commander.unknownOption":
      return `未対応のオプションです。${subject === undefined ? "" : `対象: ${subject}`}`;
    case "commander.excessArguments":
      return "指定された引数が多すぎます。";
    default:
      return "コマンドの指定が不正です。";
  }
}

function writeValidationError(
  output: CliOutput,
  message: string,
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): void {
  output.write(`${message}\n`);
  for (const issue of issues) {
    const target = issue.path.length > 0 ? issue.path.join(".") : "全体";
    output.write(`- ${target}: ${issue.message}\n`);
  }
}
