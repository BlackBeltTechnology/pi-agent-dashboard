/**
 * `acmeGc()`: delete the vault namespaces `tls:<id>` and the `acme-account-*.key`
 * files that no configured acme source needs. Runs from each source's
 * `onReconciled()`, from `onRemoved()`, from the per-entry routes and once at
 * server start. Safe-by-default: it does nothing unless `config.json` parses and
 * the vault is healthy, and concurrent calls are coalesced.
 *
 * See change: add-acme-dns01-certs (design D5, D8).
 */

import { listAccountKeyHashes, removeAccountKey } from "./accounts.js";
import { accountHash, canonicalDirectory, normalizeAcmeEntry } from "./entry.js";
import { getAcmeRuntime } from "./runtime.js";

type Json = Record<string, unknown>;

/** Configured acme entries of a raw config (`tls.sources` with `type:"acme"` and a string id). */
export function configuredAcmeEntries(raw: Json | null): Json[] {
  const tls = raw && typeof raw.tls === "object" && raw.tls && !Array.isArray(raw.tls) ? (raw.tls as Json) : null;
  const sources = tls && Array.isArray(tls.sources) ? tls.sources : [];
  return sources.filter(
    (e): e is Json => !!e && typeof e === "object" && !Array.isArray(e) && (e as Json).type === "acme" && typeof (e as Json).id === "string",
  );
}

let running: Promise<void> | null = null;
let rerun = false;

async function runOnce(): Promise<void> {
  const rt = getAcmeRuntime();
  const cfg = rt.readConfigState();
  // Only a config that parses: an absent or unreadable file must never be read as "no acme sources" (design D5).
  if (cfg.state !== "ok") return;
  if (rt.credentials.vaultState() !== "ok") return;
  const entries = configuredAcmeEntries(cfg.raw).map((e) => normalizeAcmeEntry(e));
  const ids = new Set(entries.map((e) => e.id as string));
  for (const ns of await rt.credentials.listNamespaces()) {
    if (!ids.has(ns)) {
      try {
        await rt.credentials.deleteNamespace(ns);
        rt.log.info(`gc removed vault namespace tls:${ns}`);
      } catch (err) {
        rt.log.warn(`gc could not remove tls:${ns}: ${(err as Error).name}`);
      }
    }
  }
  const wanted = new Set(
    entries.flatMap((e) => {
      const dir = canonicalDirectory(e.directory);
      return dir && typeof e.email === "string" ? [accountHash(dir, e.email)] : [];
    }),
  );
  for (const hash of await listAccountKeyHashes(rt.tlsRoot)) {
    if (!wanted.has(hash)) {
      await removeAccountKey(rt.tlsRoot, hash).catch(() => undefined);
      rt.log.info("gc removed an orphaned ACME account key");
    }
  }
}

/** Coalescing: a call during a run schedules exactly one more pass after it. */
export function acmeGc(): Promise<void> {
  if (running !== null) {
    rerun = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        rerun = false;
        await runOnce().catch((err) => getAcmeRuntime().log.warn(`gc failed: ${(err as Error).message}`));
      } while (rerun);
    } finally {
      running = null;
    }
  })();
  return running;
}
