/**
 * Write-authorization guard for `POST /api/file/write-binary` (plugin file
 * handlers). Sibling of `isWritableMdTarget`: realpath-normalizes the target,
 * contains it under the session cwd, and requires BOTH the requested and the
 * resolved extension to be one the claim declares (so `report.docx` →
 * `notes.md` is refused). Copy mode contains the parent directory only; the
 * file name is built by the caller, never taken from the request.
 *
 * Never throws — any I/O failure fails closed (`null`).
 * See change: add-editor-pane-file-handlers (D4).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { extOf } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { safeRealpath, within } from "./path-containment.js";

interface HandlerTargetClaim {
  /** Lower-case, leading-dot extensions the claim declares. */
  extensions: readonly string[];
  mode: "preview" | "edit";
}

export interface HandlerTargetOptions {
  /** Session working directory (the caller has already checked it is a known session cwd). */
  cwd: string;
  claim: HandlerTargetClaim;
  /** Default `"overwrite"`. */
  mode?: "overwrite" | "copy";
}

export interface HandlerTarget {
  /** `path.resolve(cwd, rawPath)` — the requested path. */
  requested: string;
  /** Realpath of the target (overwrite); for copy, realpath of the requested path when it exists. */
  real: string;
  /** Realpath of the parent directory (always inside the cwd root). */
  dir: string;
  /** Realpath of the cwd. */
  root: string;
  /** Extension of the requested path (lower-case, leading dot). */
  ext: string;
}

/** Resolve + authorize; returns the resolved target, or `null` when refused. */
export async function isWritableHandlerTarget(
  rawPath: string,
  opts: HandlerTargetOptions,
): Promise<HandlerTarget | null> {
  if (opts.claim.mode !== "edit" || typeof rawPath !== "string" || !rawPath || rawPath.includes("\0")) return null;
  try {
    const root = await fs.realpath(path.resolve(opts.cwd));
    const requested = path.resolve(opts.cwd, rawPath);
    const ext = extOf(requested);
    if (!ext || !opts.claim.extensions.includes(ext)) return null;
    const real = await safeRealpath(requested);
    const dir = await fs.realpath(path.dirname(requested));
    if (!within(dir, root)) return null;
    if ((opts.mode ?? "overwrite") === "overwrite") {
      if (!within(real, root)) return null;
      if (!opts.claim.extensions.includes(extOf(real))) return null;
    }
    return { requested, real, dir, root, ext };
  } catch {
    return null;
  }
}
