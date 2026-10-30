/**
 * Namespaced, locked, 0600 credential persistence for dashboard plugins.
 *
 * File `~/.pi/agent/plugin-credentials.json`, schema
 * `{ "<pluginId>": { "<key>": <record> } }`. Each store instance is bound to
 * ONE plugin id (the manifest id, bound by the host) and can only see its own
 * namespace — there is no cross-namespace surface.
 *
 * Writes (`set` / `remove` / `update`) run under the shared locked-json-file
 * lock and rewrite the whole file atomically. Reads (`get` / `list` /
 * `snapshot`) are unlocked — safe because the file is only ever replaced by an
 * atomic rename — and never create the file. Deliberately NOT
 * `connector-auth.json` (claimed by add-connector-layer with another schema).
 *
 * At rest the file is the encrypted envelope of `credential-at-rest-encryption`:
 * the store takes a REQUIRED codec and the plugin-facing API is unchanged. A
 * file this process cannot read (wrong key, damaged/newer envelope, no key
 * available) rejects every operation with `store_locked` + a non-secret
 * `reason`; a locked file is never quarantined or overwritten. Before a write
 * takes the lock, key readiness is resolved (D4) so the keychain is never
 * waited on while holding it.
 *
 * See change: expose-plugin-credential-and-oauth-seams (D2).
 * See change: encrypt-credentials-at-rest (D1, D3, D4).
 */

import os from "node:os";
import path from "node:path";
import {
  type CredentialLockReason,
  credentialRemedy,
} from "@blackbelt-technology/pi-dashboard-shared/credential-encryption.js";
import { CredentialLockedError } from "./credential-envelope.js";
import { ensureCredentialKey } from "./credential-key.js";
import {
  corruptUnbackedRefusal,
  type JsonFileCodec,
  type NotPromise,
  readJsonChecked,
  withLockedJsonFile,
  writeJsonAtomic,
} from "./locked-json-file.js";

type PluginCredentialRecord = Record<string, unknown>;

export interface PluginCredentialStore {
  get(key: string): Promise<PluginCredentialRecord | undefined>;
  /** Keys only — never record contents. */
  list(): Promise<string[]>;
  /** A clone of the caller's OWN namespace, from one read. */
  snapshot(): Promise<Record<string, PluginCredentialRecord>>;
  set(key: string, record: PluginCredentialRecord): Promise<void>;
  remove(key: string): Promise<void>;
  /**
   * Atomic read-modify-write; `fn` runs SYNCHRONOUSLY inside the lock (the lock
   * is never held across an await). Return `undefined` to delete.
   */
  update(
    key: string,
    fn: (prev: PluginCredentialRecord | undefined) => PluginCredentialRecord | undefined,
  ): Promise<PluginCredentialRecord | undefined>;
}

export type PluginCredentialErrorCode =
  | "invalid_key"
  | "invalid_record"
  | "record_too_large"
  | "too_many_keys"
  | "namespace_too_large"
  /** The file is locked (or no data key is available): carries a non-secret `reason`. */
  | "store_locked";

export class PluginCredentialError extends Error {
  readonly code: PluginCredentialErrorCode;
  /** Set only for `store_locked`: why the file is locked. Never carries file content. */
  readonly reason?: CredentialLockReason;
  constructor(code: PluginCredentialErrorCode, message: string, reason?: CredentialLockReason) {
    super(message);
    this.name = "PluginCredentialError";
    this.code = code;
    if (reason !== undefined) this.reason = reason;
  }
}

/** `store_locked` with the shared remedy text; names the reason, never any content. */
function storeLocked(reason: CredentialLockReason): PluginCredentialError {
  return new PluginCredentialError(
    "store_locked",
    `Plugin credential store is locked (${reason}). ${credentialRemedy(reason)}`,
    reason,
  );
}

/** Map the codec's write refusal onto the plugin-facing error; everything else passes through. */
function mapCodecError(err: unknown): unknown {
  return err instanceof CredentialLockedError ? storeLocked(err.reason) : err;
}

/**
 * Write prologue (D4): make sure a data key is available BEFORE the store lock
 * is taken. Only consults the key singleton when the codec has no key yet (a
 * deferred key is created here, on the first credential write); with a key in
 * hand it is a no-op. Throws `store_locked` when no key can be had.
 */
async function ensureWritable(codec: JsonFileCodec): Promise<void> {
  if (codec.unavailableReason() === undefined) return;
  const state = await ensureCredentialKey();
  const reason = codec.unavailableReason();
  if (reason === undefined) return;
  // A transient creation-lock refusal is not cached by the singleton: report it as such.
  throw storeLocked(state.state === "unavailable" && state.transient ? state.reason : reason);
}

const MAX_KEY_LENGTH = 200;
export const MAX_RECORD_BYTES = 64 * 1024;
const MAX_KEYS_PER_NAMESPACE = 256;
const MAX_NAMESPACE_BYTES = 2 * 1024 * 1024;

const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const LOG_TAG = "plugin-credentials";

type Namespace = Record<string, PluginCredentialRecord>;
type FileData = Record<string, Namespace>;

function defaultPluginCredentialsPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "plugin-credentials.json");
}

function validateKey(key: unknown, what = "key"): asserts key is string {
  if (typeof key !== "string" || key.length < 1 || key.length > MAX_KEY_LENGTH || RESERVED_KEYS.has(key)) {
    throw new PluginCredentialError("invalid_key", `Invalid credential ${what}`);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Validate and normalise a record to its JSON form; returns the serialized byte length. */
function checkRecord(record: unknown): { value: PluginCredentialRecord; bytes: number } {
  if (!isPlainObject(record)) {
    throw new PluginCredentialError("invalid_record", "Credential record must be a plain JSON object");
  }
  let json: string;
  try {
    json = JSON.stringify(record);
  } catch {
    throw new PluginCredentialError("invalid_record", "Credential record is not JSON-serializable");
  }
  const bytes = Buffer.byteLength(json, "utf-8");
  if (bytes > MAX_RECORD_BYTES) {
    throw new PluginCredentialError("record_too_large", `Credential record exceeds ${MAX_RECORD_BYTES} bytes`);
  }
  return { value: JSON.parse(json) as PluginCredentialRecord, bytes };
}

/** Own-property, null-prototype view of one namespace. */
function namespaceOf(data: FileData, pluginId: string): Namespace {
  const out: Namespace = Object.create(null);
  const raw = Object.hasOwn(data, pluginId) ? data[pluginId] : undefined;
  if (!isPlainObject(raw)) return out;
  for (const key of Object.keys(raw)) {
    const rec = raw[key];
    if (RESERVED_KEYS.has(key) || !isPlainObject(rec)) continue;
    out[key] = rec as PluginCredentialRecord;
  }
  return out;
}

/** Assert the per-namespace caps on the post-mutation namespace. */
function checkNamespaceCaps(ns: Namespace): void {
  if (Object.keys(ns).length > MAX_KEYS_PER_NAMESPACE) {
    throw new PluginCredentialError("too_many_keys", `Plugin namespace exceeds ${MAX_KEYS_PER_NAMESPACE} keys`);
  }
  if (Buffer.byteLength(JSON.stringify(ns), "utf-8") > MAX_NAMESPACE_BYTES) {
    throw new PluginCredentialError("namespace_too_large", `Plugin namespace exceeds ${MAX_NAMESPACE_BYTES} bytes`);
  }
}

/**
 * Locked read-modify-write of one namespace: refuses a corrupt file it could
 * not back up, applies `fn`, enforces the caps, and rewrites the whole file
 * atomically (an emptied namespace is dropped).
 */
async function mutateNamespace<T>(
  filePath: string,
  pluginId: string,
  codec: JsonFileCodec,
  fn: (ns: Namespace) => T & NotPromise<T>,
): Promise<T> {
  await ensureWritable(codec);
  return withLockedJsonFile(filePath, (): T & NotPromise<T> => {
    const checked = readJsonChecked<FileData>(filePath, LOG_TAG, codec);
    // A locked envelope is never backed up as corrupt and never overwritten.
    if (checked.locked) throw storeLocked(checked.locked);
    if (checked.corrupt && !checked.quarantined) throw corruptUnbackedRefusal(filePath);
    const data: FileData = Object.assign(Object.create(null), checked.data);
    const ns = namespaceOf(data, pluginId);
    const result = fn(ns);
    checkNamespaceCaps(ns);
    if (Object.keys(ns).length === 0) delete data[pluginId];
    else data[pluginId] = ns;
    try {
      writeJsonAtomic(filePath, data, checked.corrupt ? 0o600 : undefined, codec);
    } catch (err) {
      throw mapCodecError(err);
    }
    return result;
  }, { logTag: LOG_TAG, codec });
}

export interface PluginCredentialStoreOptions {
  /** REQUIRED. Production: `getCredentialCodec("plugin-credentials")`; tests: a codec over a fixed key. */
  codec: JsonFileCodec;
  /** Default `~/.pi/agent/plugin-credentials.json`. */
  path?: string;
}

export function createPluginCredentialStore(
  pluginId: string,
  options: PluginCredentialStoreOptions,
): PluginCredentialStore {
  const codec = (options as Partial<PluginCredentialStoreOptions> | undefined)?.codec;
  if (!codec || typeof codec.decode !== "function") {
    throw new TypeError("createPluginCredentialStore requires a credential codec");
  }
  const filePath = options.path ?? defaultPluginCredentialsPath();
  validateKey(pluginId, "namespace");

  const readNs = (): Namespace => {
    const checked = readJsonChecked<FileData>(filePath, LOG_TAG, codec);
    if (checked.locked) throw storeLocked(checked.locked);
    return namespaceOf(checked.data, pluginId);
  };

  const mutate = <T>(fn: (ns: Namespace) => T & NotPromise<T>): Promise<T> =>
    mutateNamespace(filePath, pluginId, codec, fn);

  return {
    async get(key) {
      validateKey(key);
      const rec = readNs()[key];
      return rec === undefined ? undefined : structuredClone(rec);
    },
    async list() {
      return Object.keys(readNs());
    },
    async snapshot() {
      return structuredClone({ ...readNs() });
    },
    async set(key, record) {
      validateKey(key);
      const { value } = checkRecord(record);
      await mutate((ns) => { ns[key] = value; });
    },
    async remove(key) {
      validateKey(key);
      await mutate((ns) => { delete ns[key]; });
    },
    async update(key, fn) {
      validateKey(key);
      return mutate((ns): PluginCredentialRecord | undefined => {
        const prev = ns[key];
        const next = fn(prev === undefined ? undefined : structuredClone(prev));
        if (next === undefined) {
          delete ns[key];
          return undefined;
        }
        const { value } = checkRecord(next);
        ns[key] = value;
        return structuredClone(value);
      });
    },
  };
}
