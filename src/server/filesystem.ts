import {
  constants,
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse } from "node:path";

export function inspectManaged(
  stat: {
    isSymbolicLink(): boolean;
    isDirectory(): boolean;
    isFile(): boolean;
    uid: number;
    mode: number;
  },
  directory: boolean,
) {
  if (stat.isSymbolicLink()) throw new Error("SYMLINK: Use a real local path.");
  if (directory ? !stat.isDirectory() : !stat.isFile())
    throw new Error("INVALID_FILE_TYPE");
  if (process.getuid && stat.uid !== process.getuid())
    throw new Error("WRONG_OWNER: Repair ownership before starting.");
  if ((stat.mode & 0o077) !== 0)
    throw new Error(
      "UNSAFE_PERMISSIONS: Remove group and other access before starting.",
    );
}
export function secureDirectory(path: string): string {
  process.umask(0o077);
  if (!isAbsolute(path)) throw new Error("ABSOLUTE_DATA_DIR_REQUIRED");
  const parts = path.slice(parse(path).root.length).split("/").filter(Boolean);
  let current = parse(path).root;
  for (const part of parts) {
    current = join(current, part);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    const stat = lstatSync(current);
    if (stat.isSymbolicLink())
      throw new Error("SYMLINK: Use a real local path.");
    if (!stat.isDirectory()) throw new Error("INVALID_DIRECTORY");
  }
  inspectManaged(lstatSync(path), true);
  return realpathSync(path);
}
export function validateFile(path: string) {
  if (existsSync(path)) inspectManaged(lstatSync(path), false);
  else {
    try {
      const stat = lstatSync(path);
      inspectManaged(stat, false);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
export function createFile(path: string, contents: string | Uint8Array = "") {
  const fd = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    inspectManaged(fstatSync(fd), false);
    writeFileSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function syncDirectory(path: string) {
  const fd = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function syncFile(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    inspectManaged(fstatSync(fd), false);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function managedParent(path: string) {
  secureDirectory(dirname(path));
  validateFile(path);
}
