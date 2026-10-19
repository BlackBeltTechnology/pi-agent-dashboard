/**
 * Pure logic for plugin file-handler modes: claim matching/ordering, instance
 * key, containment, and the cap / LRU eviction plan. No React, no I/O.
 *
 * See change: add-editor-pane-file-handlers (D2, D5).
 */
import type { ClaimEntry } from "@blackbelt-technology/dashboard-plugin-runtime";
import { HANDLER_MAX_BYTES } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import { extOf } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import type { ComponentType } from "react";

/** Live handler instances per browser page, across plugins and sessions. */
export const MAX_LIVE_HANDLERS = 3;

/** `true`/`"unknown"` = unsaved: every guard treats `"unknown"` as dirty. */
export type DirtyState = boolean | "unknown";
export const isGuarded = (d: DirtyState): boolean => d !== false;

/** One enabled `editor-pane-file-handler` claim, normalised for the host. */
export interface HandlerClaim {
  pluginId: string;
  claimId: string;
  /** `"<pluginId>/<claimId>"` — the persisted `handlerMode` value. */
  ref: string;
  label: string;
  mode: "preview" | "edit";
  extensions: string[];
  priority: number;
  keepAlive: boolean;
  /** `keepAlive.max` — lowers this claim's own share of the cap. */
  keepAliveMax?: number;
  maxBytes: number;
  firstOverwriteNotice?: string;
  copySuffix?: string;
  // biome-ignore lint/suspicious/noExplicitAny: plugin-supplied component, props = FileHandlerProps
  Component: ComponentType<any>;
}

const claimRef = (pluginId: string, claimId: string): string => `${pluginId}/${claimId}`;

function toHandlerClaim(e: ClaimEntry): HandlerClaim | null {
  if (!e.id || !e.Component || !e.extensions?.length || !e.label) return null;
  return {
    pluginId: e.pluginId,
    claimId: e.id,
    ref: claimRef(e.pluginId, e.id),
    label: e.label,
    mode: e.mode ?? "preview",
    extensions: e.extensions,
    priority: e.priority ?? 1000,
    keepAlive: !!e.keepAlive,
    keepAliveMax: e.keepAlive?.max,
    maxBytes: Math.min(e.maxBytes ?? HANDLER_MAX_BYTES, HANDLER_MAX_BYTES),
    firstOverwriteNotice: e.firstOverwriteNotice,
    copySuffix: e.copySuffix,
    Component: e.Component,
  };
}

/** Plugin priority asc, then plugin id, then claim id (design D1). */
function compareHandlerClaims(a: HandlerClaim, b: HandlerClaim): number {
  return a.priority - b.priority || a.pluginId.localeCompare(b.pluginId) || a.claimId.localeCompare(b.claimId);
}

/** Claims whose extension list matches `path` (case-insensitive via the shared `extOf`), in switcher order. */
export function claimsForPath(entries: readonly ClaimEntry[], path: string): HandlerClaim[] {
  const ext = extOf(path);
  if (!ext) return [];
  return entries
    .map(toHandlerClaim)
    .filter((c): c is HandlerClaim => !!c && c.extensions.includes(ext))
    .sort(compareHandlerClaims);
}

const isAbs = (p: string): boolean => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);

/** POSIX-normalise (`./a` ≡ `a`, `a//b`, `a/./b`, `a/x/../b`); keeps a leading `/` and unresolvable `..`. */
export function normalizeRelPath(p: string): string {
  const abs = p.startsWith("/");
  const out: string[] = [];
  for (const seg of p.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else if (seg === ".." && abs) continue;
    else out.push(seg);
  }
  return (abs ? "/" : "") + out.join("/");
}

/** Whether `path` (cwd-relative or absolute) lies under `cwd` — the write route's anchor. */
export function isUnderCwd(cwd: string, path: string): boolean {
  const n = normalizeRelPath(path);
  if (!n) return false;
  if (isAbs(path)) {
    const root = normalizeRelPath(cwd);
    return !!root && n.startsWith(`${root}/`);
  }
  return n !== ".." && !n.startsWith("../");
}

/** `sessionId + cwd + normalize(path) + claim` (design D5). */
export function instanceKey(sessionId: string, cwd: string, path: string, ref: string): string {
  return [sessionId, cwd, normalizeRelPath(path), ref].join("\u241f");
}

/** Minimal instance view for the mount plan. */
export interface LiveLite {
  key: string;
  claimRef: string;
  dirty: DirtyState;
  /** Monotonic activation clock; smaller = less recently used. */
  lastActivated: number;
}

export type MountPlan = { kind: "fits" } | { kind: "evict"; key: string } | { kind: "blocked"; keys: string[] };

/**
 * Plan mounting `incoming` among the `live` (non-evicted) instances: fits, evict
 * the least-recently-activated CLEAN (`false`) instance, or blocked (every
 * candidate is unsaved/unknown → the caller asks the user). A claim's
 * `keepAlive.max` caps its own instances first; otherwise the page cap applies.
 */
export function planMount(
  live: readonly LiveLite[],
  incoming: { key: string; claimRef: string; keepAliveMax?: number },
  max: number = MAX_LIVE_HANDLERS,
): MountPlan {
  if (live.some((i) => i.key === incoming.key)) return { kind: "fits" };
  const sameClaim = live.filter((i) => i.claimRef === incoming.claimRef);
  let pool: readonly LiveLite[];
  if (incoming.keepAliveMax !== undefined && sameClaim.length >= incoming.keepAliveMax) pool = sameClaim;
  else if (live.length >= max) pool = live;
  else return { kind: "fits" };
  const lru = pool.filter((i) => i.dirty === false).sort((a, b) => a.lastActivated - b.lastActivated)[0];
  if (lru) return { kind: "evict", key: lru.key };
  return { kind: "blocked", keys: pool.filter((i) => isGuarded(i.dirty)).map((i) => i.key) };
}
