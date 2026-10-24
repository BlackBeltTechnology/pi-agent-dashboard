/**
 * Provisioning report (`version`, `source`, `dir`, `bytes`, `licence`, `jspi`), failure report and the
 * read-only cache status. Nothing here downloads or writes.
 *
 * See change: add-blender-wasm-mcp (spec: Provisioning report, task 2.4).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isValidCache, PIN, type PinSpec, ProvisionError, readStamp, resolveCacheRoot } from "./pin.js";
import type { ProvisionDeps, ProvisionResult } from "./provision.js";

export type JspiMode = "native" | "flag" | "unavailable";

export interface ProvisionReport extends ProvisionResult {
  jspi: JspiMode;
}

export interface FailureReport {
  code: string;
  message: string;
}

export interface CacheStatus {
  pinned: { version: string; cached: boolean; dir: string };
  root: string;
  source: "override" | "managed";
  versions: { version: string; bytes: number; dir: string }[];
  licence: string;
}

/** Total on-disk bytes of every regular file below `dir` (0 when it does not exist). */
export function dirBytes(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += dirBytes(p);
    else if (e.isFile()) total += fs.statSync(p).size;
  }
  return total;
}

function packageField(dir: string, field: string): string | undefined {
  try {
    const pkg: unknown = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const v = (pkg as Record<string, unknown> | null)?.[field];
    if (typeof v === "string" && v.trim()) return v.trim();
    // Legacy `{ "type": "MIT" }` licence objects.
    const t = (v as { type?: unknown } | null | undefined)?.type;
    return typeof t === "string" && t.trim() ? t.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** `license` field of the runtime dir's `package.json`, else `"unknown"`. */
export function readLicence(dir: string): string {
  return packageField(dir, "license") ?? "unknown";
}

/** `version` field of the runtime dir's `package.json`, else `"unknown"`. */
export function readPackageVersion(dir: string): string {
  return packageField(dir, "version") ?? "unknown";
}

export function provisionReport(result: ProvisionResult, jspi: JspiMode): ProvisionReport {
  const { version, source, dir, bytes, licence } = result;
  return { version, source, dir, bytes, licence, jspi };
}

export function failureReport(err: unknown): FailureReport {
  if (err instanceof ProvisionError) return { code: err.code, message: err.message };
  return { code: "provision-failed", message: err instanceof Error ? err.message : String(err) };
}

/**
 * Pinned version, every cached (stamped) version with its on-disk bytes, the active source and the licence.
 * With `BLENDER_WASM_DIR` set the source is `override` and the licence is that directory's.
 */
export function cacheStatus(partial: Partial<Pick<ProvisionDeps, "env" | "homedir" | "pin">> = {}): CacheStatus {
  const env = partial.env ?? process.env;
  const pin: PinSpec = partial.pin ?? PIN;
  const root = resolveCacheRoot(env, partial.homedir ?? os.homedir);
  const pinnedDir = path.join(root, pin.version);
  const cached = isValidCache(pinnedDir, pin);

  const versions: CacheStatus["versions"] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    /* no cache yet */
  }
  for (const name of names.filter((n) => !n.startsWith(".")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const dir = path.join(root, name);
    if (readStamp(dir)) versions.push({ version: name, bytes: dirBytes(dir), dir });
  }

  const overrideDir = env.BLENDER_WASM_DIR ? path.resolve(env.BLENDER_WASM_DIR) : undefined;
  const licence = overrideDir ? readLicence(overrideDir) : cached ? readLicence(pinnedDir) : "unknown";
  return { pinned: { version: pin.version, cached, dir: pinnedDir }, root, source: overrideDir ? "override" : "managed", versions, licence };
}
