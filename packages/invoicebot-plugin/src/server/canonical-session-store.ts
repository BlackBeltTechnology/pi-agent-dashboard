/**
 * Dedicated durable canonical `invoice → sessionId` store (Decision 1, Option B).
 *
 * The invoice→session link is persisted here, NOT reconstructed from a session's
 * own `.meta.json` — that metadata (`kind` / `automationRun`) is wiped by the
 * shared full-overwrite persistence and is never rehydrated, so it cannot back a
 * durable canonical identity. This store is the restart-safe + resume-safe source
 * of truth, keyed by `cwd\0invoiceId`, owned by the invoicebot plugin.
 *
 * The store binding — not any per-session stamp — is the authority that "this
 * session id is the invoice's canonical session".
 *
 * See change: make-invoice-session-canonical (Decision 1).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const KEY_SEP = "\u0000";

function keyFor(cwd: string, invoiceId: string): string {
  return `${cwd}${KEY_SEP}${invoiceId}`;
}

export interface CanonicalSessionStore {
  /** The canonical session id for an invoice, or undefined. */
  get(cwd: string, invoiceId: string): string | undefined;
  /** Record (or re-point) the canonical session id; persisted to disk. */
  set(cwd: string, invoiceId: string, sessionId: string): void;
  /** Drop the mapping (unrecoverable session); persisted to disk. */
  delete(cwd: string, invoiceId: string): void;
  /** Reverse lookup: the { cwd, invoiceId } a session id is canonical for, or
   *  undefined. Used to re-apply a resumed session's bound scope (§5.4). */
  scopeFor(sessionId: string): { cwd: string; invoiceId: string } | undefined;
}

/** Default on-disk location, sibling to the dashboard's other plugin stores. */
export function defaultCanonicalStorePath(): string {
  return join(homedir(), ".pi", "dashboard", "invoicebot", "canonical-sessions.json");
}

/**
 * File-backed store. Loads the whole map once on construction (the in-memory map
 * doubles as the fast-path cache); every mutation is written back atomically
 * (tmp + rename). A missing or corrupt file yields an empty store — never throws.
 */
export function createCanonicalSessionStore(filePath: string): CanonicalSessionStore {
  const map = new Map<string, string>();

  try {
    if (existsSync(filePath)) {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string" && v) map.set(k, v);
        }
      }
    }
  } catch {
    // Missing / corrupt file → start empty. The store re-materialises from live
    // resolution (re-spawn + re-link) rather than crashing the plugin.
  }

  function persist(): void {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(Object.fromEntries(map), null, 2)}\n`);
      renameSync(tmp, filePath);
    } catch {
      // Best-effort durability. The in-memory map stays authoritative for this
      // process; a failed write only costs durability across a restart.
    }
  }

  return {
    get(cwd, invoiceId) {
      return map.get(keyFor(cwd, invoiceId));
    },
    set(cwd, invoiceId, sessionId) {
      map.set(keyFor(cwd, invoiceId), sessionId);
      persist();
    },
    delete(cwd, invoiceId) {
      if (map.delete(keyFor(cwd, invoiceId))) persist();
    },
    scopeFor(sessionId) {
      for (const [k, v] of map) {
        if (v !== sessionId) continue;
        const sep = k.indexOf(KEY_SEP);
        if (sep < 0) continue;
        return { cwd: k.slice(0, sep), invoiceId: k.slice(sep + KEY_SEP.length) };
      }
      return undefined;
    },
  };
}
