/**
 * Startup publication of the resolved spawn runtime (design D8).
 *
 * `publishResolvedRuntime` writes the diagnostic `runtime.resolved` block
 * into the RAW `~/.pi/dashboard/config.json` object — never through the
 * typed config loader, whose schema does not know `runtime.*` and would
 * strip the unknown keys this write must preserve byte-for-byte.
 *
 * Hard rules (spec: managed-node-runtime / "Resolved runtime is published
 * for diagnosis"):
 *  - the user-owned `runtime.override` key is NEVER written here — the
 *    read-modify-write round-trips it untouched, so publication can neither
 *    destroy a user's pin nor become one;
 *  - unknown top-level keys survive;
 *  - a corrupt/unparseable config is NEVER overwritten (bail with a warning
 *    — a naive fallback write would truncate the user's config);
 *  - the write is atomic (tmp + rename via `writeJsonFile`), so a leftover
 *    `.tmp` from an interrupted write can never masquerade as config.
 *
 * Nothing consumes `runtime.resolved` for execution: the ladder re-resolves
 * live at every server start (`runtime-resolution.ts`) and re-validates at
 * spawn time. The block is inspectable only.
 *
 * See change: unify-pi-runtime-identity (task 4.1, design D8).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import {
  buildPublishedRuntimeBlock,
  type ResolvedRuntime,
} from "@blackbelt-technology/pi-dashboard-shared/platform/spawn-runtime.js";
import { writeJsonFile } from "./persistence/json-store.js";

export interface PublishResolvedRuntimeOpts {
  /** Default `~/.pi/dashboard/config.json`. Tests inject a tmp path. */
  configPath?: string;
  /** Passed through to `buildPublishedRuntimeBlock` (bundle-path detection). */
  resourcesPath?: string;
  /** Warn sink; default `console.warn`. */
  warn?: (msg: string) => void;
}

export interface PublishResult {
  /** The `runtime.resolved` block (shape owned by `buildPublishedRuntimeBlock`). */
  block: Record<string, unknown>;
  /** False when publication bailed (corrupt/foreign config) — nothing written. */
  written: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Default config path — `~/.pi/dashboard/config.json`. */
function defaultRuntimeConfigPath(): string {
  return path.join(getDashboardConfigDir(), "config.json");
}

/**
 * Publish `runtime.resolved` into the raw config JSON, atomically.
 *
 * Bails (warns, writes nothing) when the existing file is unparseable or its
 * `runtime` key is not an object — either way the file keeps foreign data the
 * dashboard must not truncate. Bundle-internal runtimes are published
 * path-free; `buildPublishedRuntimeBlock` owns that decision.
 */
export function publishResolvedRuntime(
  rt: ResolvedRuntime,
  opts: PublishResolvedRuntimeOpts = {},
): PublishResult {
  const warn = opts.warn ?? console.warn;
  const block = buildPublishedRuntimeBlock(rt, { resourcesPath: opts.resourcesPath });
  const file = opts.configPath ?? defaultRuntimeConfigPath();

  let root: Record<string, unknown>;
  if (existsSync(file)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf-8"));
    } catch {
      parsed = undefined;
    }
    if (!isPlainObject(parsed)) {
      // Never overwrite a corrupt config — the write would silently truncate
      // every user key the dashboard cannot re-derive (spec hard rule).
      warn(
        `[runtime] refusing to publish runtime.resolved — ${file} is corrupt/unparseable; leaving it untouched`,
      );
      return { block, written: false };
    }
    root = parsed;
  } else {
    root = {};
  }

  if (root.runtime !== undefined && !isPlainObject(root.runtime)) {
    // A non-object `runtime` value cannot carry `.override`, but it is still
    // foreign data in a dashboard-owned namespace — bail rather than replace.
    warn(
      `[runtime] refusing to publish runtime.resolved — ${file} has a non-object "runtime" key; leaving it untouched`,
    );
    return { block, written: false };
  }

  // Raw-object merge: `runtime.override` (and any sibling user keys) ride
  // through untouched; unknown top-level keys survive by construction.
  const next: Record<string, unknown> = {
    ...root,
    runtime: { ...(root.runtime ?? {}), resolved: block },
  };
  writeJsonFile(file, next);
  return { block, written: true };
}

/**
 * Read the published `runtime.resolved` block (raw JSON read — the typed
 * loader strips it). Absent/malformed → null. Used by `pi-dashboard runtime`.
 */
export function readPublishedRuntimeBlock(
  configPath?: string,
): Record<string, unknown> | null {
  const file = configPath ?? defaultRuntimeConfigPath();
  try {
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as {
      runtime?: { resolved?: unknown };
    };
    const block = parsed.runtime?.resolved;
    return isPlainObject(block) ? block : null;
  } catch {
    return null;
  }
}
