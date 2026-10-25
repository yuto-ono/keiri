import { readFile } from "node:fs/promises";

import { runCli } from "#lib/cli/run-cli";
import { todayInTokyo } from "#lib/domain/business-date";
import { FileInvoiceCreationGateway } from "#lib/server/file-invoice-creation-gateway";
import { FileInvoiceUpdateGateway } from "#lib/server/file-invoice-update-gateway";
import { FileInvoiceIssueGateway } from "#lib/server/file-invoice-issue-gateway";
import { FileInvoiceRevertToDraftGateway } from "#lib/server/file-invoice-revert-to-draft-gateway";
import { FileInvoiceDeletionGateway } from "#lib/server/file-invoice-deletion-gateway";
import { PlaywrightInvoicePdfRenderer } from "#lib/server/playwright-invoice-pdf-renderer";

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
    createIssueGateway: (dataDirectory) =>
      new FileInvoiceIssueGateway(dataDirectory),
    createRevertToDraftGateway: (dataDirectory) =>
      new FileInvoiceRevertToDraftGateway(dataDirectory),
    createDeletionGateway: (dataDirectory) =>
      new FileInvoiceDeletionGateway(dataDirectory),
    createPdfRenderer: (repositoryRoot) =>
      new PlaywrightInvoicePdfRenderer(repositoryRoot),
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
