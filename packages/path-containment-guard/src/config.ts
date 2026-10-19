/**
 * Guard configuration — read once from the `extensionConfig` env projection
 * (`PI_EXT_PATH_CONTAINMENT_GUARD_{ALLOWED_ROOTS,DENIED_TOOLS}`, JSON arrays).
 *
 * Fail-closed by construction: an unusable `ALLOWED_ROOTS` blocks every path
 * tool (`scope: "path"`, valid denied tools still apply); an unusable
 * `DENIED_TOOLS` blocks every tool (`scope: "all"`) because dropping an entry
 * could silently lose an intended denial. Individual bad root entries are
 * dropped (fewer roots only ever rejects more).
 * See change: add-path-containment-guard-extension (D3).
 */

import nodePath from "node:path";
import { PATH_CONTAINMENT_GUARD_EXT_NAME } from "@blackbelt-technology/pi-dashboard-shared/path-containment-guard-name.js";
import { canonicalizeTarget, defaultResolveEnv, type ResolveEnv } from "@blackbelt-technology/pi-dashboard-shared/tool-path-resolve.js";
import { captureFaults } from "./strict-env.js";

const ENV_PREFIX = `PI_EXT_${PATH_CONTAINMENT_GUARD_EXT_NAME.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}_`;
const ALLOWED_ROOTS_ENV = `${ENV_PREFIX}ALLOWED_ROOTS`;
const DENIED_TOOLS_ENV = `${ENV_PREFIX}DENIED_TOOLS`;

export type GuardConfig =
  | { ok: true; roots: string[]; deniedTools: ReadonlySet<string> }
  | { ok: false; scope: "path"; deniedTools: ReadonlySet<string> }
  | { ok: false; scope: "all" };

/** A root the guard accepts: non-empty, NUL-free, absolute (on Windows: drive or UNC form). */
export function isAcceptableRoot(p: unknown, platform: NodeJS.Platform = process.platform): p is string {
  if (typeof p !== "string" || p === "" || p.includes("\0")) return false;
  if (platform === "win32") return /^[a-zA-Z]:[\\/]/.test(p) || /^[\\/]{2}[^\\/]/.test(p);
  return nodePath.posix.isAbsolute(p);
}

function parseJsonArray(raw: string | undefined): unknown[] | null {
  if (raw === undefined) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** `undefined` (absent) / `[]` → deny nothing; anything malformed → `null` (block all). */
function parseDenied(raw: string | undefined): Set<string> | null {
  if (raw === undefined) return new Set();
  const arr = parseJsonArray(raw);
  if (arr === null) return null;
  if (!arr.every((e) => typeof e === "string" && e !== "")) return null;
  return new Set(arr as string[]);
}

function parseRoots(raw: string | undefined, platform: NodeJS.Platform, resolveEnv: ResolveEnv): string[] {
  const arr = parseJsonArray(raw);
  if (arr === null) return [];
  const roots = new Set<string>();
  for (const entry of arr) {
    if (!isAcceptableRoot(entry, platform)) continue;
    try {
      const cap = captureFaults(resolveEnv);
      const canonical = canonicalizeTarget(entry, cap.env);
      if (cap.fault() === undefined) roots.add(canonical);
    } catch {
      // a root whose canonicalisation fails (e.g. a symlink loop) is ignored
    }
  }
  return [...roots];
}

export interface ParseOptions {
  platform?: NodeJS.Platform;
  resolveEnv?: ResolveEnv;
}

export function parseGuardConfig(
  env: Readonly<Record<string, string | undefined>>,
  opts: ParseOptions = {},
): GuardConfig {
  const resolveEnv = opts.resolveEnv ?? defaultResolveEnv();
  const platform = opts.platform ?? resolveEnv.platform;
  const deniedTools = parseDenied(env[DENIED_TOOLS_ENV]);
  if (deniedTools === null) return { ok: false, scope: "all" };
  const roots = parseRoots(env[ALLOWED_ROOTS_ENV], platform, resolveEnv);
  if (roots.length === 0) return { ok: false, scope: "path", deniedTools };
  return { ok: true, roots, deniedTools };
}
