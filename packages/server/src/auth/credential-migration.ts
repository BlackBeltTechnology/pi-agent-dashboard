/**
 * Startup migration of plaintext credential files (design D7, D11).
 *
 * After the data key is ready, each credential file that holds a valid
 * plaintext JSON object is migrated in place, one file at a time, under its own
 * store lock: parse → encrypt → decode the ciphertext in memory and deep-compare
 * with the parsed plaintext (abort on mismatch) → atomic replace (temp + rename,
 * 0600). No plaintext backup is kept: a lingering copy would keep the exposure
 * this change removes. Existing `<file>.corrupt-*` siblings are never touched
 * (the migration never calls the quarantine path). A file that cannot be
 * migrated stays plaintext and readable; the next credential write encrypts it.
 *
 * One `[credential-key] <basename> state=<…> [reason=<code>]` line per file.
 * Lines carry the basename and a short reason code only: never a value, key or
 * kid. Never throws: a failure is a log line, so startup always continues.
 * See change: encrypt-credentials-at-rest (D7, D11).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  CREDENTIAL_FILE_BASENAMES,
  CREDENTIAL_FILE_IDS,
  type CredentialFileId,
} from "@blackbelt-technology/pi-dashboard-shared/credential-encryption.js";
import { getCredentialCodec } from "./credential-key.js";
import { type JsonFileCodec, withLockedJsonFile, writeJsonAtomic } from "./locked-json-file.js";

export type CredentialFileState = "encrypted" | "plaintext" | "locked" | "absent" | "corrupt";

export interface CredentialFileOutcome {
  id: CredentialFileId;
  basename: string;
  state: CredentialFileState;
  /** Why the file is `locked`, or why a `plaintext` file stayed plaintext. */
  reason?: string;
  /** This run replaced the plaintext by an envelope. */
  migrated: boolean;
}

export interface MigrateCredentialFilesOptions {
  /** Default `os.homedir()`. Files: `<home>/.pi/agent/plugin-credentials.json`, `<home>/.pi/dashboard/vault.json`. */
  home?: string;
  /** Explicit file paths (win over `home`). */
  paths?: Partial<Record<CredentialFileId, string>>;
  /** Default: the process singleton codec, `getCredentialCodec`. Tests inject a codec over a fixed key. */
  codecFor?: (id: CredentialFileId) => JsonFileCodec;
  /** Sink for `[credential-key]` lines. Default `console.log`. */
  log?: (line: string) => void;
}

const MIGRATION_ORDER: readonly CredentialFileId[] = CREDENTIAL_FILE_IDS; // plugin-credentials first, then vault (lock order, D7)

function defaultPath(id: CredentialFileId, home: string): string {
  return id === "vault"
    ? path.join(home, ".pi", "dashboard", CREDENTIAL_FILE_BASENAMES.vault)
    : path.join(home, ".pi", "agent", CREDENTIAL_FILE_BASENAMES["plugin-credentials"]);
}

/** A short, content-free reason code from a failure (`EIO`, `ECOMPROMISED`, …). */
function failureReason(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code) ? `migration_failed_${code}` : "migration_failed";
}

type Peek = { kind: "absent" | "encrypted" | "plaintext" | "corrupt" } | { kind: "locked"; reason: string };

/** Unlocked, side-effect-free classification (never quarantines). */
function peek(file: string, codec: JsonFileCodec): Peek {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    return { kind: "corrupt" };
  }
  const out = codec.decode(bytes);
  if (out.kind === "absent") return { kind: "absent" };
  if (out.kind === "locked") return { kind: "locked", reason: out.reason };
  if (out.kind === "corrupt") return { kind: "corrupt" };
  return { kind: out.encrypted ? "encrypted" : "plaintext" };
}

type MigrateResult = { migrated: true } | { migrated: false; reason: string; state: CredentialFileState };

/** Encrypt → verify → atomic replace of the bytes read just now. Runs inside the file's lock. */
function replaceVerified(file: string, existing: Buffer, data: Record<string, unknown>, codec: JsonFileCodec): MigrateResult {
  const encoded = codec.encode(data, existing);
  const check = codec.decode(encoded);
  if (check.kind !== "document" || !check.encrypted || !isDeepStrictEqual(check.data, data)) {
    return { migrated: false, state: "plaintext", reason: "verify_mismatch" };
  }
  // Write exactly the bytes that were verified.
  const verified: JsonFileCodec = { ...codec, encode: () => encoded };
  try {
    writeJsonAtomic(file, data, 0o600, verified);
  } catch (err) {
    try { fs.unlinkSync(`${file}.tmp`); } catch { /* best effort: it holds ciphertext only */ }
    throw err;
  }
  return { migrated: true };
}

/** Under the lock: re-read (another process may have migrated or replaced the file), then migrate. */
function migrateLocked(file: string, codec: JsonFileCodec): MigrateResult {
  // Raw read + decode, never `readJsonChecked`, so a file that went corrupt meanwhile is not quarantined by us.
  let existing: Buffer;
  try {
    existing = fs.readFileSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { migrated: false, state: "absent", reason: "" };
    throw err;
  }
  const current = codec.decode(existing);
  if (current.kind === "locked") return { migrated: false, state: "locked", reason: current.reason };
  if (current.kind !== "document") return { migrated: false, state: "corrupt", reason: "" };
  if (current.encrypted) return { migrated: false, state: "encrypted", reason: "" };
  return replaceVerified(file, existing, current.data, codec);
}

function migrateOne(file: string, codec: JsonFileCodec): Promise<MigrateResult> {
  return withLockedJsonFile(file, (): MigrateResult => migrateLocked(file, codec), { codec, createIfMissing: false, logTag: "credential-key" });
}

type FileResult = Pick<CredentialFileOutcome, "state" | "reason" | "migrated">;

/** Classify one file and migrate it when it is plaintext and the key is ready. Never throws. */
async function handleFile(file: string, codec: JsonFileCodec): Promise<FileResult> {
  try {
    const seen = peek(file, codec);
    if (seen.kind === "locked") return { state: "locked", reason: seen.reason, migrated: false };
    if (seen.kind !== "plaintext") return { state: seen.kind, migrated: false };
    const keyReason = codec.unavailableReason();
    if (keyReason) return { state: "plaintext", reason: keyReason, migrated: false };
    const done = await migrateOne(file, codec);
    if (done.migrated) return { state: "encrypted", migrated: true };
    return { state: done.state, ...(done.reason ? { reason: done.reason } : {}), migrated: false };
  } catch (err) {
    return { state: "plaintext", reason: failureReason(err), migrated: false };
  }
}

/**
 * Migrate every plaintext credential file whose key is ready, and log one line
 * per file. Call after `initCredentialKey` has settled. Never throws.
 */
export async function migrateCredentialFiles(options: MigrateCredentialFilesOptions = {}): Promise<CredentialFileOutcome[]> {
  const home = options.home ?? os.homedir();
  const log = options.log ?? ((line: string) => console.log(line));
  const codecFor = options.codecFor ?? getCredentialCodec;
  const outcomes: CredentialFileOutcome[] = [];

  for (const id of MIGRATION_ORDER) {
    const basename = CREDENTIAL_FILE_BASENAMES[id];
    const result = await handleFile(options.paths?.[id] ?? defaultPath(id, home), codecFor(id));
    outcomes.push({ id, basename, ...result });
    log(`[credential-key] ${basename} state=${result.state}${result.reason ? ` reason=${result.reason}` : ""}`);
  }
  return outcomes;
}
