/**
 * Hub-owned credential vault store: `~/.pi/dashboard/vault.json`.
 *
 * Accounts (kind `key`, namespace `user`; kind `tls-solver`, namespace `tls:<sourceId>`,
 * owned by the ACME certificate source) plus the records later modules own
 * (`bindings`, `grants`, `confirmations`, `pluginApprovals`). Built on the
 * shared locked-json-file primitives with `createIfMissing: false`, so the file
 * does not exist until the first account is added; always 0600 on POSIX.
 *
 * Forward compatibility: every write is a read-modify-write of the RAW parsed
 * document, so unknown top-level fields, unknown account kinds and unknown
 * namespaces survive a write by a version that does not recognise them.
 *
 * Corruption: a byte-exact backup is kept (by `readJsonChecked`) and EVERY
 * write is refused, even when the backup succeeded. Errors name the file and the
 * backup path, never any file content (a parse message can echo it).
 *
 * Values never leave through listings: `AccountView` carries no value. The only
 * value reader is `getKeyValue`, for delivery and plugin reads.
 *
 * See change: add-credential-vault (D1), add-acme-dns01-certs (D5).
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import {
  type NotPromise,
  readJsonChecked,
  withLockedJsonFile,
  writeJsonAtomic,
} from "../auth/locked-json-file.js";

/** Values shorter than this are rejected on entry and on import. */
export const MIN_VALUE_LENGTH = 8;
const MAX_VALUE_LENGTH = 16 * 1024;
const MAX_LABEL_LENGTH = 200;
const LOG_TAG = "vault";

export type VaultErrorCode =
  | "value_too_short"
  | "value_too_long"
  | "invalid_field"
  | "vault_corrupt"
  | "not_found"
  | "invalid_binding_name"
  | "invalid_grant"
  | "invalid_request"
  | "managed_account";

export class VaultError extends Error {
  readonly code: VaultErrorCode;
  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

/** The raw document. Unknown fields are kept; known collections are plain arrays of unknowns. */
export interface VaultDocument {
  accounts?: unknown[];
  bindings?: unknown[];
  grants?: unknown[];
  confirmations?: unknown[];
  pluginApprovals?: unknown[];
  [unknownField: string]: unknown;
}

/** A stored account as this version understands it. */
export interface StoredAccount {
  id: string;
  provider: string;
  kind: string;
  namespace: string;
  label: string;
  value?: string;
  createdAt?: string;
}

/** The only account shape that leaves the store through a listing: no value. */
export interface AccountView {
  id: string;
  provider: string;
  kind: string;
  namespace: string;
  label: string;
}

type VaultStatus =
  | { state: "absent" }
  | { state: "ok" }
  | { state: "corrupt"; backup?: string };

export interface AddAccountInput {
  provider: string;
  label: string;
  value: string;
}

/** Kind of the DNS-01 solver secrets of an ACME certificate source. Never delivered, bound or generically rotated/revoked. */
const TLS_SOLVER_KIND = "tls-solver";
const TLS_NAMESPACE_PREFIX = "tls:";
const tlsNamespace = (sourceId: string): string => `${TLS_NAMESPACE_PREFIX}${sourceId}`;

interface UpsertTlsSecretsInput {
  sourceId: string;
  provider: string;
  entries: Array<{ label: string; value: string }>;
}

export interface VaultStore {
  readonly filePath: string;
  status(): Promise<VaultStatus>;
  listAccounts(): Promise<AccountView[]>;
  /** The delivery-only value reader. Returns undefined for a missing or non-`key` account. */
  getKeyValue(accountId: string): string | undefined;
  addAccount(input: AddAccountInput): Promise<AccountView>;
  /** Checked, side-effect-free snapshot of the document for sibling modules. */
  readDocument(): { status: VaultStatus; doc: VaultDocument };
  /**
   * Locked read-modify-write. `fn` runs synchronously inside the lock on the raw
   * document and may mutate it in place. Refused on a corrupt file.
   */
  update<T>(fn: (doc: VaultDocument) => T & NotPromise<T>): Promise<T>;
  /** Replace a `key` account's value in place (same id, so bindings and grants stay valid). */
  rotateAccount(accountId: string, value: string): Promise<void>;
  /**
   * INTERNAL (no HTTP route): write `tls-solver` secrets of namespace `tls:<sourceId>` in ONE locked
   * update. Per label: rotate the account found by `(namespace, label)`, else add it. All labels or none.
   */
  upsertTlsSecrets(input: UpsertTlsSecretsInput): Promise<void>;
  /** INTERNAL: remove every `tls-solver` account of `tls:<sourceId>`. No write when there is none. */
  deleteTlsNamespace(sourceId: string): Promise<void>;
  /**
   * INTERNAL: the only reader of `tls-solver` values. `null` = absent. Throws `vault_corrupt`
   * when the vault is unreadable (the caller maps that to "credential vault unavailable").
   */
  readTlsSecret(sourceId: string, label: string): Promise<string | null>;
  /** INTERNAL: source ids that hold at least one `tls-solver` account (for GC). `[]` on a corrupt vault. */
  listTlsNamespaces(): Promise<string[]>;
  /**
   * Subscribe to committed writes. Listeners run after the lock is released and
   * must not throw; a throwing listener is logged and ignored. Returns unsubscribe.
   */
  onChange(listener: () => void): () => void;
}

function defaultVaultPath(): string {
  return path.join(getDashboardConfigDir(), "vault.json");
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** The `<file>.corrupt-*` backup whose bytes equal the file's, if one exists. */
export function findBackup(filePath: string): string | undefined {
  try {
    const bytes = fs.readFileSync(filePath);
    const dir = path.dirname(filePath);
    const prefix = `${path.basename(filePath)}.corrupt-`;
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(prefix)) continue;
      try {
        if (fs.readFileSync(path.join(dir, name)).equals(bytes)) return path.join(dir, name);
      } catch { /* racing cleanup */ }
    }
  } catch { /* file vanished */ }
  return undefined;
}

function corruptError(filePath: string): VaultError {
  const backup = findBackup(filePath);
  return new VaultError(
    "vault_corrupt",
    `vault file is corrupt (backup: ${backup ?? "none"}); fix or remove ${filePath} and try again`,
  );
}

export function accountView(a: StoredAccount): AccountView {
  return { id: a.id, provider: a.provider, kind: a.kind, namespace: a.namespace, label: a.label };
}

/** Accounts with the minimum well-formed shape; the rest are carried through writes untouched. */
export function wellFormedAccounts(doc: VaultDocument): StoredAccount[] {
  const out: StoredAccount[] = [];
  for (const a of Array.isArray(doc.accounts) ? doc.accounts : []) {
    if (
      isRecord(a) &&
      typeof a.id === "string" &&
      typeof a.provider === "string" &&
      typeof a.kind === "string" &&
      typeof a.namespace === "string" &&
      typeof a.label === "string"
    ) out.push(a as unknown as StoredAccount);
  }
  return out;
}

function validateText(v: unknown, what: string): asserts v is string {
  if (typeof v !== "string" || v.trim().length === 0 || v.length > MAX_LABEL_LENGTH) {
    throw new VaultError("invalid_field", `Invalid ${what}`);
  }
}

/** Exported so import shares the exact entry rule. */
function validateValue(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new VaultError("invalid_field", "Invalid value");
  if (value.length < MIN_VALUE_LENGTH) {
    throw new VaultError("value_too_short", `Value must be at least ${MIN_VALUE_LENGTH} characters`);
  }
  if (value.length > MAX_VALUE_LENGTH) {
    throw new VaultError("value_too_long", `Value must be at most ${MAX_VALUE_LENGTH} characters`);
  }
}

/** A new `key` account (shared by `addAccount` and import so both apply one rule). */
export function makeKeyAccount({ provider, label, value }: AddAccountInput): StoredAccount {
  validateText(provider, "provider");
  validateText(label, "label");
  validateValue(value);
  return {
    id: randomUUID(),
    provider: provider.trim(),
    kind: "key",
    namespace: "user",
    label: label.trim(),
    value,
    createdAt: new Date().toISOString(),
  };
}

const isTlsAccount = (a: unknown, namespace?: string): a is StoredAccount =>
  isRecord(a) &&
  a.kind === TLS_SOLVER_KIND &&
  typeof a.namespace === "string" &&
  a.namespace.startsWith(TLS_NAMESPACE_PREFIX) &&
  (namespace === undefined || a.namespace === namespace);

export function createVaultStore(filePath: string = defaultVaultPath()): VaultStore {
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const l of [...listeners]) {
      try { l(); } catch (err) { console.warn(`[${LOG_TAG}] change listener failed: ${(err as Error)?.name ?? "error"}`); }
    }
  };
  const readDocument = (): { status: VaultStatus; doc: VaultDocument } => {
    const checked = readJsonChecked<VaultDocument>(filePath, LOG_TAG);
    if (checked.corrupt) {
      return { status: { state: "corrupt", backup: findBackup(filePath) }, doc: {} };
    }
    return { status: fs.existsSync(filePath) ? { state: "ok" } : { state: "absent" }, doc: checked.data };
  };

  const update = async <T>(fn: (doc: VaultDocument) => T & NotPromise<T>): Promise<T> => {
    const result = await withLockedJsonFile(
      filePath,
      (): T & NotPromise<T> => {
        const checked = readJsonChecked<VaultDocument>(filePath, LOG_TAG);
        if (checked.corrupt) throw corruptError(filePath);
        const doc = checked.data;
        const result = fn(doc);
        writeJsonAtomic(filePath, doc);
        return result;
      },
      { logTag: LOG_TAG, createIfMissing: false },
    );
    notify();
    return result;
  };

  return {
    filePath,
    readDocument,
    update,
    async status() {
      return readDocument().status;
    },
    async listAccounts() {
      return wellFormedAccounts(readDocument().doc).map(accountView);
    },
    getKeyValue(accountId) {
      const a = wellFormedAccounts(readDocument().doc).find((x) => x.id === accountId);
      if (a?.kind !== "key" || typeof a.value !== "string") return undefined;
      return a.value;
    },
    async addAccount(input) {
      const account = makeKeyAccount(input);
      await update((doc) => {
        if (!Array.isArray(doc.accounts)) doc.accounts = [];
        doc.accounts.push(account);
      });
      return accountView(account);
    },
    async rotateAccount(accountId, value) {
      validateValue(value);
      await update((doc) => {
        const a = (Array.isArray(doc.accounts) ? doc.accounts : []).find(
          (x): x is Record<string, unknown> => isRecord(x) && x.id === accountId && x.kind === "key",
        );
        if (!a) throw new VaultError("not_found", "Account not found");
        a.value = value;
        a.rotatedAt = new Date().toISOString();
      });
    },
    async upsertTlsSecrets({ sourceId, provider, entries }) {
      validateText(sourceId, "source id");
      validateText(provider, "provider");
      if (!Array.isArray(entries) || entries.length === 0) throw new VaultError("invalid_field", "Invalid entries");
      // Validate every entry before the lock so a bad later label can never leave an earlier one written.
      for (const e of entries) {
        validateText(e?.label, "label");
        validateValue(e.value);
      }
      const namespace = tlsNamespace(sourceId);
      await update((doc) => {
        if (!Array.isArray(doc.accounts)) doc.accounts = [];
        const now = new Date().toISOString();
        for (const { label, value } of entries) {
          const existing = doc.accounts.find(
            (x): x is Record<string, unknown> => isTlsAccount(x, namespace) && x.label === label.trim(),
          );
          if (existing) {
            existing.value = value;
            existing.provider = provider.trim();
            existing.rotatedAt = now;
          } else {
            doc.accounts.push({
              id: randomUUID(),
              provider: provider.trim(),
              kind: TLS_SOLVER_KIND,
              namespace,
              label: label.trim(),
              value,
              createdAt: now,
            } satisfies StoredAccount);
          }
        }
      });
    },
    async deleteTlsNamespace(sourceId) {
      const { status, doc } = readDocument();
      if (status.state === "corrupt") throw corruptError(filePath);
      const namespace = tlsNamespace(sourceId);
      if (!(Array.isArray(doc.accounts) ? doc.accounts : []).some((a) => isTlsAccount(a, namespace))) return;
      await update((d) => {
        d.accounts = (Array.isArray(d.accounts) ? d.accounts : []).filter((a) => !isTlsAccount(a, namespace));
      });
    },
    async readTlsSecret(sourceId, label) {
      const { status, doc } = readDocument();
      if (status.state === "corrupt") throw corruptError(filePath);
      const namespace = tlsNamespace(sourceId);
      const a = (Array.isArray(doc.accounts) ? doc.accounts : []).find((x) => isTlsAccount(x, namespace) && x.label === label);
      return isRecord(a) && typeof a.value === "string" ? a.value : null;
    },
    async listTlsNamespaces() {
      const ids = new Set<string>();
      const { accounts } = readDocument().doc;
      for (const a of Array.isArray(accounts) ? accounts : []) {
        if (isTlsAccount(a)) ids.add(a.namespace.slice(TLS_NAMESPACE_PREFIX.length));
      }
      return [...ids];
    },
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
