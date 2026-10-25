import { isAbsolute, resolve } from "node:path";

export class DataDirectoryConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataDirectoryConfigurationError";
  }
}

export function resolveKeiriDataDirectory(
  repositoryRoot: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configuredPath = environment.KEIRI_DATA_DIR;
  if (configuredPath === undefined || configuredPath.length === 0) {
    throw new DataDirectoryConfigurationError(
      ".envのKEIRI_DATA_DIRにkeiri-dataのパスを指定してください。",
    );
  }

  return isAbsolute(configuredPath)
    ? resolve(configuredPath)
    : resolve(repositoryRoot, configuredPath);
}
