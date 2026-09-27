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
 * See change: expose-plugin-credential-and-oauth-seams (D2).
 */

import os from "node:os";
import path from "node:path";
import {
  corruptUnbackedRefusal,
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
  /** Atomic read-modify-write; `fn` runs inside the lock. Return `undefined` to delete. */
  update(
    key: string,
    fn: (prev: PluginCredentialRecord | undefined) =>
      PluginCredentialRecord | undefined | Promise<PluginCredentialRecord | undefined>,
  ): Promise<PluginCredentialRecord | undefined>;
}

export type PluginCredentialErrorCode =
  | "invalid_key"
  | "invalid_record"
  | "record_too_large"
  | "too_many_keys"
  | "namespace_too_large";

export class PluginCredentialError extends Error {
  readonly code: PluginCredentialErrorCode;
  constructor(code: PluginCredentialErrorCode, message: string) {
    super(message);
    this.name = "PluginCredentialError";
    this.code = code;
  }
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
function mutateNamespace<T>(
  filePath: string,
  pluginId: string,
  fn: (ns: Namespace) => Promise<T> | T,
): Promise<T> {
  return withLockedJsonFile(filePath, async () => {
    const checked = readJsonChecked<FileData>(filePath, LOG_TAG);
    if (checked.corrupt && !checked.quarantined) throw corruptUnbackedRefusal(filePath);
    const data: FileData = Object.assign(Object.create(null), checked.data);
    const ns = namespaceOf(data, pluginId);
    const result = await fn(ns);
    checkNamespaceCaps(ns);
    if (Object.keys(ns).length === 0) delete data[pluginId];
    else data[pluginId] = ns;
    writeJsonAtomic(filePath, data, checked.corrupt ? 0o600 : undefined);
    return result;
  });
}

export function createPluginCredentialStore(
  pluginId: string,
  filePath: string = defaultPluginCredentialsPath(),
): PluginCredentialStore {
  validateKey(pluginId, "namespace");

  const readNs = (): Namespace => {
    const { data } = readJsonChecked<FileData>(filePath, LOG_TAG);
    return namespaceOf(data, pluginId);
  };

  const mutate = <T>(fn: (ns: Namespace) => Promise<T> | T): Promise<T> =>
    mutateNamespace(filePath, pluginId, fn);

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
      return mutate(async (ns) => {
        const prev = ns[key];
        const next = await fn(prev === undefined ? undefined : structuredClone(prev));
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
