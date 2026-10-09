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
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

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
export function createFile(
  path: string,
  contents: string | Uint8Array = "",
  beforeWrite?: () => void,
) {
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
    beforeWrite?.();
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

export type AppRoot = Readonly<{ path: string; dev: number; ino: number }>;
function inspectPath(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(
      "PRIVATE_PATH_UNVERIFIABLE: Verify local path permissions.",
    );
  }
}
function canonicalPath(path: string) {
  try {
    return realpathSync(path);
  } catch {
    throw new Error(
      "PRIVATE_PATH_UNVERIFIABLE: Verify local path permissions.",
    );
  }
}
export function activeAppRoot(): AppRoot {
  const path = canonicalPath(process.cwd());
  const stat = inspectPath(path);
  if (!stat?.isDirectory()) throw new Error("PRIVATE_PATH_UNVERIFIABLE");
  return Object.freeze({ path, dev: stat.dev, ino: stat.ino });
}
export function privateDestination(path: string, root: AppRoot): string {
  if (!isAbsolute(path)) throw new Error("ABSOLUTE_DATA_DIR_REQUIRED");
  const parts = path.slice(parse(path).root.length).split("/").filter(Boolean);
  let current = parse(path).root;
  for (const [index, part] of parts.entries()) {
    current = part === ".." ? dirname(current) : join(current, part);
    const stat = inspectPath(current);
    if (stat?.isSymbolicLink())
      throw new Error("SYMLINK: Use a real local path.");
    if (stat && index < parts.length - 1 && !stat.isDirectory())
      throw new Error("INVALID_DIRECTORY");
  }
  const normalized = resolve(path);
  let existing = normalized;
  const missing: string[] = [];
  let stat = inspectPath(existing);
  while (!stat) {
    missing.unshift(basename(existing));
    const parent = dirname(existing);
    if (parent === existing) throw new Error("PRIVATE_PATH_UNVERIFIABLE");
    existing = parent;
    stat = inspectPath(existing);
  }
  if (missing.length && !stat.isDirectory())
    throw new Error("INVALID_DIRECTORY");
  const canonical = join(canonicalPath(existing), ...missing);
  const difference = relative(root.path, canonical);
  if (
    !difference ||
    (difference !== ".." &&
      !difference.startsWith(".." + sep) &&
      !isAbsolute(difference))
  )
    throw new Error(
      "PRIVATE_PATH_INSIDE_APP: Use a data or backup path outside the application.",
    );
  let ancestor = stat.isDirectory() ? existing : dirname(existing);
  while (true) {
    const directory = inspectPath(ancestor);
    if (!directory?.isDirectory() || directory.isSymbolicLink())
      throw new Error("PRIVATE_PATH_UNVERIFIABLE");
    if (directory.dev === root.dev && directory.ino === root.ino)
      throw new Error(
        "PRIVATE_PATH_INSIDE_APP: Use a data or backup path outside the application.",
      );
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  return canonical;
}
