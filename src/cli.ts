import { readFile } from "node:fs/promises";

import { runCli } from "#lib/cli/run-cli";
import { todayInTokyo } from "#lib/domain/business-date";
import { FileInvoiceCreationGateway } from "#lib/server/file-invoice-creation-gateway";
import { FileInvoiceUpdateGateway } from "#lib/server/file-invoice-update-gateway";

const exitCode = await runCli(
  process.argv,
  {
    repositoryRoot: process.cwd(),
    environment: process.env,
    today: todayInTokyo(),
    createGateway: (dataDirectory) =>
      new FileInvoiceCreationGateway(dataDirectory),
    createUpdateGateway: (dataDirectory) =>
      new FileInvoiceUpdateGateway(dataDirectory),
    readInput: async (path) =>
      path === "-" ? readStandardInput() : readFile(path, "utf8"),
  },
  {
    stdout: { write: (text) => process.stdout.write(text) },
    stderr: { write: (text) => process.stderr.write(text) },
  },
);

process.exitCode = exitCode;

async function readStandardInput(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let contents = "";
  for await (const chunk of process.stdin) {
    contents += chunk;
  }
  return contents;
}
