import Database from "better-sqlite3";
import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { createFile, secureDirectory, validateFile } from "./filesystem";

export function acquireInstance(path: string) {
  const dataDir = secureDirectory(path);
  const lockPath = join(dataDir, "instance-lock.sqlite");
  validateFile(lockPath);
  if (!existsSync(lockPath)) {
    try {
      createFile(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  validateFile(lockPath);
  validateFile(lockPath + "-journal");
  const inode = lstatSync(lockPath).ino;
  const lock = new Database(lockPath);
  try {
    lock.pragma("busy_timeout = 0");
    lock.pragma("journal_mode = DELETE");
    lock.exec("BEGIN EXCLUSIVE");
  } catch {
    lock.close();
    throw new Error("INSTANCE_BUSY: Stop the existing AgentFlow instance.");
  }
  return {
    dataDir,
    inode,
    release() {
      if (lock.open) {
        lock.exec("ROLLBACK");
        lock.close();
      }
    },
  };
}
