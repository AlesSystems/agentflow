import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Store } from "../db";
import { createFile, syncDirectory, validateFile } from "./filesystem";
const schema = z
  .object({
    schemaVersion: z.literal(1),
    pairingToken: z.string().regex(/^[a-f0-9]{64}$/),
    reporterToken: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .refine((value) => value.pairingToken !== value.reporterToken);
export type Credentials = z.infer<typeof schema>;
export const cookieName = "agentflow_session";
export const sessionLifetime = 43_200_000;
export function hashSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}
export function equalSecret(candidate: string, expected: string) {
  return timingSafeEqual(
    Buffer.from(hashSecret(candidate), "hex"),
    Buffer.from(hashSecret(expected), "hex"),
  );
}
function newCredentials(): Credentials {
  return {
    schemaVersion: 1,
    pairingToken: randomBytes(32).toString("hex"),
    reporterToken: randomBytes(32).toString("hex"),
  };
}
function stageCredentials(dataDir: string, credentials: Credentials) {
  const path = join(dataDir, `credentials-stage-${randomUUID()}.json`);
  createFile(path, JSON.stringify(credentials) + "\n");
  return path;
}
export function loadCredentials(dataDir: string) {
  const path = join(dataDir, "credentials.json");
  validateFile(path);
  for (const name of readdirSync(dataDir).filter((name) =>
    /^credentials-stage-[a-f0-9-]+\.json$/.test(name),
  )) {
    const staged = join(dataDir, name);
    validateFile(staged);
    unlinkSync(staged);
  }
  if (!existsSync(path)) {
    const credentials = newCredentials();
    const staged = stageCredentials(dataDir, credentials);
    renameSync(staged, path);
    syncDirectory(dataDir);
    return credentials;
  }
  let input: unknown;
  try { input = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("INVALID_CREDENTIALS: Repair credentials.json before starting."); }
  const result = schema.safeParse(input);
  if (!result.success)
    throw new Error(
      "INVALID_CREDENTIALS: Repair credentials.json before starting.",
    );
  return result.data;
}
export type RotationPhase = "staged" | "revoked" | "published";
export function rotateCredentials(
  dataDir: string,
  store: Store,
  phase?: (phase: RotationPhase) => void,
) {
  validateFile(join(dataDir, "credentials.json"));
  const credentials = newCredentials();
  const staged = stageCredentials(dataDir, credentials);
  phase?.("staged");
  store.revokeAll();
  phase?.("revoked");
  renameSync(staged, join(dataDir, "credentials.json"));
  syncDirectory(dataDir);
  phase?.("published");
  return credentials;
}
export function sessionCookie(secret: string, clear = false) {
  return `${cookieName}=${clear ? "" : secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : 43200}`;
}
export function cookieSecret(cookie: string | null | undefined) {
  const values = (cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(cookieName + "="));
  if (values.length > 1) throw new Error("AMBIGUOUS_AUTH");
  return values[0]?.slice(cookieName.length + 1);
}
export function createSession(store: Store) {
  const secret = randomBytes(32).toString("hex");
  const now = Date.now();
  const id = store.createSession(
    hashSecret(secret),
    now,
    now + sessionLifetime,
  );
  return { secret, id };
}
