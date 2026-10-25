import { unlink } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  BusinessPartnerManagementContext,
  BusinessPartnerManagementGateway,
} from "#lib/application/manage-business-partners";
import type { BusinessPartner } from "#lib/domain/model";
import { businessPartnerSchema } from "#lib/persistence/schemas";
import { parseYaml } from "#lib/persistence/yaml-parser";
import { serializeBusinessPartner } from "#lib/persistence/yaml-serializer";
import {
  moveTextFileAtomically,
  writeTextFileAtomically,
} from "#lib/server/atomic-write";
import { loadKeiriData } from "#lib/server/keiri-data-loader";

export class FileBusinessPartnerGateway implements BusinessPartnerManagementGateway {
  readonly #rootDirectory: string;

  constructor(rootDirectory: string) {
    this.#rootDirectory = rootDirectory;
  }

  async loadManagementContext(): Promise<BusinessPartnerManagementContext> {
    const data = await loadKeiriData(this.#rootDirectory);
    return {
      businessPartners: data.businessPartners.map((record) => record.data),
      issuers: data.issuers.map((record) => record.data),
      invoices: data.invoices.map((record) => record.data),
    };
  }

  async saveNewBusinessPartner(
    partner: BusinessPartner,
  ): Promise<{ filePath: string }> {
    const filePath = partnerPath(partner);
    await writeTextFileAtomically(
      resolve(this.#rootDirectory, filePath),
      serializeBusinessPartner(partner),
      {
        overwrite: false,
        validate: (contents) => {
          parseYaml(contents, filePath, businessPartnerSchema);
        },
      },
    );
    return { filePath };
  }

  async saveUpdatedBusinessPartner(
    current: BusinessPartner,
    updated: BusinessPartner,
  ): Promise<{ filePath: string }> {
    const filePath = partnerPath(updated);
    await moveTextFileAtomically(
      resolve(this.#rootDirectory, partnerPath(current)),
      resolve(this.#rootDirectory, filePath),
      serializeBusinessPartner(updated),
      (contents) => {
        parseYaml(contents, filePath, businessPartnerSchema);
      },
    );
    return { filePath };
  }

  async deleteBusinessPartner(
    partner: BusinessPartner,
  ): Promise<{ filePath: string }> {
    const filePath = partnerPath(partner);
    await unlink(resolve(this.#rootDirectory, filePath));
    return { filePath };
  }
}

function partnerPath(partner: BusinessPartner): string {
  return `business-partners/${partner.code}.yaml`;
}
