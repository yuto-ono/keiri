import { resolve } from "node:path";

import type {
  IssuerUpdateContext,
  IssuerUpdateGateway,
} from "#lib/application/update-issuer";
import type { Issuer } from "#lib/domain/model";
import { issuerSchema } from "#lib/persistence/schemas";
import { parseYaml } from "#lib/persistence/yaml-parser";
import { serializeIssuer } from "#lib/persistence/yaml-serializer";
import { writeTextFileAtomically } from "#lib/server/atomic-write";
import { loadKeiriData } from "#lib/server/keiri-data-loader";

export class FileIssuerUpdateGateway implements IssuerUpdateGateway {
  readonly #rootDirectory: string;

  constructor(rootDirectory: string) {
    this.#rootDirectory = rootDirectory;
  }

  async loadUpdateContext(issuerId: string): Promise<IssuerUpdateContext> {
    const data = await loadKeiriData(this.#rootDirectory);
    return {
      issuer: data.issuers.find((record) => record.data.id === issuerId)?.data,
      businessPartners: data.businessPartners.map((record) => record.data),
    };
  }

  async saveUpdatedIssuer(
    current: Issuer,
    updated: Issuer,
  ): Promise<{ filePath: string }> {
    const filePath = `issuers/${current.id}.yaml`;
    await writeTextFileAtomically(
      resolve(this.#rootDirectory, filePath),
      serializeIssuer(updated),
      {
        overwrite: true,
        validate: (contents) => {
          parseYaml(contents, filePath, issuerSchema);
        },
      },
    );
    return { filePath };
  }
}
