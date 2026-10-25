import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface AtomicWriteOptions {
  overwrite: boolean;
  validate: (contents: string) => void;
}

export async function stageFile(
  targetPath: string,
  contents: Uint8Array,
): Promise<string> {
  const targetDirectory = dirname(targetPath);
  await mkdir(targetDirectory, { recursive: true });
  const temporaryPath = join(
    targetDirectory,
    `.${basename(targetPath)}.${randomUUID()}.tmp`,
  );
  const file = await open(temporaryPath, "wx");
  try {
    try {
      await file.writeFile(contents);
      await file.sync();
    } finally {
      await file.close();
    }
    return temporaryPath;
  } catch (error) {
    await removeTemporaryFile(temporaryPath);
    throw error;
  }
}

export async function writeTextFileAtomically(
  targetPath: string,
  contents: string,
  options: AtomicWriteOptions,
): Promise<void> {
  const targetDirectory = dirname(targetPath);
  await mkdir(targetDirectory, { recursive: true });

  if (!options.overwrite && (await pathExists(targetPath))) {
    throw new Error(`保存先 ${targetPath} は既に存在します。`);
  }

  options.validate(contents);

  const temporaryPath = join(
    targetDirectory,
    `.${basename(targetPath)}.${randomUUID()}.tmp`,
  );
  let temporaryFileExists = false;

  try {
    const file = await open(temporaryPath, "wx");
    temporaryFileExists = true;
    try {
      await file.writeFile(contents, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }

    const writtenContents = await readFile(temporaryPath, "utf8");
    options.validate(writtenContents);

    if (!options.overwrite && (await pathExists(targetPath))) {
      throw new Error(`保存先 ${targetPath} は既に存在します。`);
    }

    await rename(temporaryPath, targetPath);
    temporaryFileExists = false;
  } catch (error) {
    if (temporaryFileExists) {
      await removeTemporaryFile(temporaryPath);
    }
    throw error;
  }
}

export async function moveTextFileAtomically(
  sourcePath: string,
  targetPath: string,
  contents: string,
  validate: (contents: string) => void,
): Promise<void> {
  if (sourcePath === targetPath) {
    await writeTextFileAtomically(targetPath, contents, {
      overwrite: true,
      validate,
    });
    return;
  }

  if (await isCaseOnlyRenameOfSameFile(sourcePath, targetPath)) {
    validate(contents);
    const temporaryPath = await stageFile(
      targetPath,
      Buffer.from(contents, "utf8"),
    );
    let nameChanged = false;
    try {
      validate(await readFile(temporaryPath, "utf8"));
      // 同じファイルを指す大小文字違いの名前は、内容を反映する前に正式な表記へ変更する。
      await rename(sourcePath, targetPath);
      nameChanged = true;
      await rename(temporaryPath, targetPath);
    } catch (error) {
      try {
        if (nameChanged) {
          await rename(targetPath, sourcePath);
        }
      } finally {
        await removeTemporaryFile(temporaryPath);
      }
      throw error;
    }
    return;
  }

  await writeTextFileAtomically(targetPath, contents, {
    overwrite: false,
    validate,
  });
  try {
    await unlink(sourcePath);
  } catch (error) {
    await removeTemporaryFile(targetPath);
    throw error;
  }
}

async function isCaseOnlyRenameOfSameFile(
  sourcePath: string,
  targetPath: string,
): Promise<boolean> {
  if (sourcePath.toLowerCase() !== targetPath.toLowerCase()) {
    return false;
  }
  try {
    const [source, target] = await Promise.all([
      stat(sourcePath),
      stat(targetPath),
    ]);
    return source.dev === target.dev && source.ino === target.ino;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function removeTemporaryFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
