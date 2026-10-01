/**
 * API key sources (spec: system-one-config, "API key sources"; design D7).
 * First match wins: env var named by `keyRef`, then
 * `~/.pi/agent/system-one/auth.json` (0600, keyed by `keyRef`). Writes are
 * atomic (temp file + rename). Nothing here ever returns a key to a caller
 * other than the HTTP backend. See change: add-system-one-registry.
 */
import { readFileSync } from "node:fs";
import { atomicWrite0600 } from "./fs-util.js";
import { authPath } from "./paths.js";
import { isObj, own, safeParse } from "./safe-json.js";

export { authPath } from "./paths.js";

const KEY_REF = /^[A-Z_][A-Z0-9_]{0,127}$/;
export const isValidKeyRef = (ref: string): boolean => KEY_REF.test(ref);

function readFileKeys(): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  try {
    const v = safeParse(readFileSync(authPath(), "utf8"), () => {});
    if (isObj(v)) for (const k of Object.keys(v)) if (typeof own(v, k) === "string") out[k] = own(v, k) as string;
  } catch {
    // absent or unreadable → no file keys
  }
  return out;
}

/** The key for `keyRef`, or undefined. Only the http backend calls this. */
export function resolveKey(keyRef: string): string | undefined {
  if (!isValidKeyRef(keyRef)) return undefined;
  const env = process.env[keyRef];
  if (env) return env;
  const k = readFileKeys()[keyRef];
  return k || undefined;
}

export interface KeyStatus {
  set: boolean;
  source: "env" | "file" | null;
}

export function keyStatus(keyRef: string): KeyStatus {
  if (!isValidKeyRef(keyRef)) return { set: false, source: null };
  if (process.env[keyRef]) return { set: true, source: "env" };
  if (readFileKeys()[keyRef]) return { set: true, source: "file" };
  return { set: false, source: null };
}

/** Store (or, with an empty value, remove) a key. Atomic; mode 0600. */
export function writeKey(keyRef: string, value: string): void {
  if (!isValidKeyRef(keyRef)) throw new Error(`invalid keyRef "${keyRef}"`);
  const keys = readFileKeys();
  if (value) keys[keyRef] = value;
  else delete keys[keyRef];
  atomicWrite0600(authPath(), `${JSON.stringify(keys, null, 2)}\n`);
}
