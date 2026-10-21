/**
 * Pure helpers over `editor-pane-file-handler` claims: ordering, extension
 * matching, cwd scope and the instance key. No React state, no fetches.
 *
 * See change: add-editor-pane-file-handlers (D1, D2, D5).
 */

import type { ClaimEntry, SlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { fileHandlerClaimKey } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/file-handler.js";
import type { FileHandlerProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { extOf } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { normalizeUnderCwd } from "../../../lib/util/normalize-path.js";

/** A claim as the switcher / layer see it. */
export interface FileHandlerClaim {
  /** `<pluginId>/<claimId>` — the `handlerMode` value and the `claim` query param. */
  key: string;
  pluginId: string;
  claimId: string;
  /** Plugin-level priority (ascending, default 1000). */
  priority: number;
  meta: NonNullable<ClaimEntry["fileHandler"]>;
  Component: React.ComponentType<FileHandlerProps> | undefined;
}

/**
 * Every ENABLED file-handler claim (`getClaims` applies the enabled set), in the
 * contract order: plugin priority, then plugin id, then claim id.
 */
export function listFileHandlerClaims(registry: SlotRegistry | null): FileHandlerClaim[] {
  if (!registry) return [];
  const out: FileHandlerClaim[] = [];
  for (const c of registry.getClaims("editor-pane-file-handler")) {
    if (!c.fileHandler) continue;
    out.push({
      key: fileHandlerClaimKey(c.pluginId, c.fileHandler.id),
      pluginId: c.pluginId,
      claimId: c.fileHandler.id,
      priority: c.priority ?? 1000,
      meta: c.fileHandler,
      Component: (c as { Component?: FileHandlerClaim["Component"] }).Component,
    });
  }
  return out.sort(
    (a, b) => a.priority - b.priority || a.pluginId.localeCompare(b.pluginId) || a.claimId.localeCompare(b.claimId),
  );
}

/**
 * Claims whose extensions match `path` (case-insensitively, through the same
 * `extOf` the server uses), preserving the input order.
 */
export function claimsForPath(claims: readonly FileHandlerClaim[], path: string): FileHandlerClaim[] {
  const ext = extOf(`/${path}`);
  if (!ext) return [];
  return claims.filter((c) => c.meta.extensions.includes(ext));
}

/**
 * Handler modes exist only for files under the session cwd (the write route's
 * anchor). A tab path is cwd-relative; an absolute path outside the cwd or a
 * `..`-escaping relative one is outside.
 */
export function isUnderSessionCwd(path: string, cwd: string): boolean {
  const rel = normalizeUnderCwd(path, cwd);
  if (/^([/\\]|[A-Za-z]:[\\/])/.test(rel)) return false;
  return !posixNormalize(rel).startsWith("../") && posixNormalize(rel) !== "..";
}

/** POSIX-normalize a relative path: drop `.` and empty segments, fold `a/../`. */
function posixNormalize(path: string): string {
  const out: string[] = [];
  for (const seg of path.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/** Instance key: `sessionId + cwd + normalize(path) + claim` (D5). */
export function fileHandlerInstanceKey(sessionId: string, cwd: string, path: string, claimKey: string): string {
  return [sessionId, cwd, posixNormalize(normalizeUnderCwd(path, cwd)), claimKey].join("\u0000");
}
