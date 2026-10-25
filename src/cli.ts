import { runCli } from "#lib/cli/run-cli";
import { todayInTokyo } from "#lib/domain/business-date";
import { FileInvoiceCreationGateway } from "#lib/server/file-invoice-creation-gateway";

const exitCode = await runCli(
  process.argv,
  {
    repositoryRoot: process.cwd(),
    environment: process.env,
    today: todayInTokyo(),
    createGateway: (dataDirectory) =>
      new FileInvoiceCreationGateway(dataDirectory),
  },
  {
    stdout: { write: (text) => process.stdout.write(text) },
    stderr: { write: (text) => process.stderr.write(text) },
  },
);

process.exitCode = exitCode;
