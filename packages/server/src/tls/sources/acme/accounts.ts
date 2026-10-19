/**
 * ACME account keys: one ECDSA P-256 key per (canonical directory, lowercase
 * email) at `<tlsRoot>/acme-account-<hash>.key` (0600, atomic write). The CA
 * account URL is cached in memory so equivalent sources call `createAccount`
 * once. Orphaned keys are removed by `acmeGc()`.
 *
 * See change: add-acme-dns01-certs (design D8).
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import * as acme from "acme-client";
import { ACCOUNT_KEY_FILE_RE, accountHash, accountKeyFileName } from "./entry.js";

/** hash → CA account URL (process lifetime). */
const accountUrls = new Map<string, string>();

export function getCachedAccountUrl(hash: string): string | undefined {
  return accountUrls.get(hash);
}
export function setCachedAccountUrl(hash: string, url: string): void {
  accountUrls.set(hash, url);
}
function forgetAccount(hash: string): void {
  accountUrls.delete(hash);
}
/** Test seam. */
export function resetAccountCache(): void {
  accountUrls.clear();
}

/** Read the account key for `(directory, email)`, creating it (atomically) when absent. `mayCreate` is consulted right before the write. */
export async function loadOrCreateAccountKey(
  tlsRoot: string,
  directory: string,
  email: string,
  mayCreate: () => boolean = () => true,
): Promise<{ hash: string; keyPem: string }> {
  const hash = accountHash(directory, email);
  const file = path.join(tlsRoot, accountKeyFileName(hash));
  try {
    return { hash, keyPem: await fs.readFile(file, "utf8") };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (!mayCreate()) throw new Error("source removed");
  const keyPem = (await acme.crypto.createPrivateEcdsaKey("P-256")).toString();
  await fs.mkdir(tlsRoot, { recursive: true, mode: 0o700 });
  const tmp = path.join(tlsRoot, `.${accountKeyFileName(hash)}.${randomBytes(6).toString("hex")}.tmp`);
  await fs.writeFile(tmp, keyPem, { mode: 0o600 });
  await fs.chmod(tmp, 0o600);
  if (!mayCreate()) {
    await fs.rm(tmp, { force: true });
    throw new Error("source removed");
  }
  await fs.rename(tmp, file);
  return { hash, keyPem };
}

/** Hashes of every `acme-account-*.key` currently on disk. */
export async function listAccountKeyHashes(tlsRoot: string): Promise<string[]> {
  try {
    const names = await fs.readdir(tlsRoot);
    return names.flatMap((n) => {
      const m = ACCOUNT_KEY_FILE_RE.exec(n);
      return m ? [m[1]] : [];
    });
  } catch {
    return [];
  }
}

export async function removeAccountKey(tlsRoot: string, hash: string): Promise<void> {
  forgetAccount(hash);
  await fs.rm(path.join(tlsRoot, accountKeyFileName(hash)), { force: true });
}
