/**
 * Write-authorization guard for `POST /api/file/write-binary` — the file-handler
 * counterpart of `isWritableMdTarget` (change: add-editor-pane-file-handlers D4).
 *
 * The cwd must already have been checked as a known session's cwd by the caller
 * (`resolveScopedMdPath` style). This guard then requires:
 *   - the claim is an ENABLED `edit` claim;
 *   - overwrite: the target, after resolving symlinks and `..`, lies under the
 *     realpath of `<cwd>`, and BOTH the requested path's extension and the
 *     realpath's extension are in `claim.extensions` (a `.docx` symlink to a
 *     `.md` is refused);
 *   - copy: the realpath of the target's PARENT directory lies under `<cwd>`
 *     and the requested extension is claimed. The copy's basename is built by
 *     core (`copyBasename`), never taken from the caller.
 * Never throws; any I/O failure is a fail-closed refusal.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { extOf } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { safeRealpath, within } from "./path-containment.js";

/** The claim facts the guard needs (resolved from the server-loaded plugin registry per request). */
export interface HandlerClaimInfo {
  pluginId: string;
  claimId: string;
  mode: "preview" | "edit";
  /** Lower-case extensions with leading dot. */
  extensions: readonly string[];
  /** Effective size cap in bytes (claim `maxBytes`, default the core ceiling). */
  maxBytes: number;
  copySuffix?: string;
  /** Manifest `validator: true` — saves require a registered validator. */
  validator: boolean;
  pluginEnabled: boolean;
}

export type HandlerTarget =
  | { ok: true; kind: "overwrite"; requested: string; real: string; ext: string }
  | { ok: true; kind: "copy"; requested: string; realDir: string; ext: string }
  | { ok: false };

export async function isWritableHandlerTarget(
  requested: string,
  opts: { cwd: string; claim: HandlerClaimInfo; mode: "overwrite" | "copy" },
): Promise<HandlerTarget> {
  const { claim } = opts;
  if (!path.isAbsolute(requested)) return { ok: false };
  if (claim.mode !== "edit" || !claim.pluginEnabled) return { ok: false };
  const exts = new Set(claim.extensions);
  const requestedExt = extOf(requested);
  if (!exts.has(requestedExt)) return { ok: false };
  try {
    const root = await fs.realpath(path.resolve(opts.cwd));
    if (opts.mode === "overwrite") {
      const real = await safeRealpath(requested);
      if (!exts.has(extOf(real)) || !within(real, root)) return { ok: false };
      return { ok: true, kind: "overwrite", requested, real, ext: requestedExt };
    }
    const realDir = await fs.realpath(path.dirname(requested)); // parent must exist
    if (!within(realDir, root)) return { ok: false };
    return { ok: true, kind: "copy", requested, realDir, ext: requestedExt };
  } catch {
    return { ok: false };
  }
}

/**
 * Basename of the `attempt`-th copy candidate: `<stem>.<suffix>.<ext>` for
 * attempt 1, `<stem>.<suffix>-<n>.<ext>` for n = attempt ≥ 2. Stem and extension
 * come from the REQUESTED basename (extension case preserved).
 */
export function copyBasename(requested: string, suffix: string, attempt: number): string {
  const base = path.basename(requested);
  const ext = base.slice(base.lastIndexOf("."));
  const stem = base.slice(0, base.length - ext.length);
  return `${stem}.${suffix}${attempt > 1 ? `-${attempt}` : ""}${ext}`;
}

/** Highest copy attempt number (`-99`); the 100th candidate does not exist. */
export const MAX_COPY_ATTEMPTS = 99;
