/**
 * Durable plugin-owned session refs.
 *
 * Plugins stamp keys onto a session (spawn `pluginRef`, `ctx.assignSessionRef`).
 * Core used to persist them only via a one-shot `mergeSessionMeta`, which the
 * next routine save (`sessionToMeta` → FULL overwrite from a fixed field list)
 * wiped; the boot scan also restored only named fields. Core now keeps an
 * owner-namespaced bag `session.pluginRefs[pluginId]` that it serializes and
 * restores VERBATIM (it never parses the interior), and projects every bag key
 * onto the session top level (the historical plugin-facing shape).
 *
 * Bounds: a plugin's bag must be JSON-plain and ≤ PLUGIN_REF_BAG_MAX_BYTES; a
 * write that would break either is dropped for THAT plugin only (warn), so one
 * plugin cannot bloat or break every meta write.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { CORE_RESERVED_REF_KEYS } from "../pending/pending-plugin-ref-registry.js";
import type { SessionManager } from "./memory-session-manager.js";

export const PLUGIN_REF_BAG_MAX_BYTES = 16 * 1024;

export type PluginRefBags = Record<string, Record<string, unknown>>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** JSON-plain: primitives, arrays, plain objects; no cycles, functions, class instances. */
function isJsonPlain(v: unknown, seen: Set<unknown> = new Set()): boolean {
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v !== "object") return false;
  if (seen.has(v)) return false;
  seen.add(v);
  const items = Array.isArray(v) ? v : isPlainObject(v) ? Object.values(v) : null;
  const ok = items !== null && items.every((x) => isJsonPlain(x, seen));
  seen.delete(v);
  return ok;
}

/** A key a plugin may own: not core-reserved, not the bag itself, not a prototype hook. */
function isOwnableKey(k: string): boolean {
  return !CORE_RESERVED_REF_KEYS.has(k) && k !== "__proto__" && k !== "constructor" && k !== "prototype";
}

/**
 * Validate bags read from an (untrusted) sidecar: plain objects only, keys
 * ownable, values JSON-plain, per-plugin size bound. Invalid bags are dropped.
 */
export function sanitizePersistedBags(raw: unknown): PluginRefBags | undefined {
  if (!isPlainObject(raw)) return undefined;
  const out: PluginRefBags = {};
  for (const [owner, bag] of Object.entries(raw)) {
    if (!isOwnableKey(owner) || !isPlainObject(bag)) continue;
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(bag)) {
      if (isOwnableKey(k) && isJsonPlain(v)) clean[k] = v;
    }
    if (Object.keys(clean).length > 0 && JSON.stringify(clean).length <= PLUGIN_REF_BAG_MAX_BYTES) out[owner] = clean;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Flatten every bag onto one object (the session top-level projection). */
export function projectPluginRefs(bags: unknown): Record<string, unknown> {
  const clean = sanitizePersistedBags(bags);
  const out: Record<string, unknown> = {};
  if (!clean) return out;
  for (const bag of Object.values(clean)) Object.assign(out, bag);
  return out;
}

/**
 * Merge `sanitized` into `ownerId`'s bag (`undefined` deletes a key). Returns
 * the new bags, or `null` when the result would not be JSON-plain / would
 * exceed the per-plugin bound (caller drops the write for this plugin).
 */
export function mergePluginRefBag(
  bags: PluginRefBags | undefined,
  ownerId: string,
  sanitized: Record<string, unknown>,
): PluginRefBags | undefined | null {
  const bag: Record<string, unknown> = { ...(bags?.[ownerId] ?? {}) };
  for (const [k, v] of Object.entries(sanitized)) {
    if (v === undefined) delete bag[k];
    else bag[k] = v;
  }
  if (!isJsonPlain(bag) || JSON.stringify(bag).length > PLUGIN_REF_BAG_MAX_BYTES) return null;
  const next: PluginRefBags = { ...(bags ?? {}) };
  if (Object.keys(bag).length > 0) next[ownerId] = bag;
  else delete next[ownerId];
  return Object.keys(next).length > 0 ? next : undefined;
}

export interface ApplyPluginRefDeps {
  sessionManager: Pick<SessionManager, "get" | "update">;
  /** Registry boundary: drops reserved / foreign-owned keys, claims new ones. */
  sanitize: (ref: unknown, ownerId: string) => Record<string, unknown>;
}

/**
 * Apply a plugin ref to a live session: sanitize, and — when `persist` — record
 * it in the owner's bag so the routine save and the boot scan keep it. Returns
 * the top-level keys actually applied (empty ⇒ nothing changed). The caller
 * persists (`mergeSessionMeta` with `{...applied, pluginRefs}`) and broadcasts.
 */
export function applyPluginRef(
  deps: ApplyPluginRefDeps,
  sessionId: string,
  ownerId: string,
  ref: unknown,
  opts: { persist: boolean },
): Record<string, unknown> {
  const session = deps.sessionManager.get(sessionId);
  if (!session) return {};
  const sanitized = deps.sanitize(ref, ownerId);
  if (Object.keys(sanitized).length === 0) return {};
  const update: Record<string, unknown> = { ...sanitized };
  if (opts.persist) {
    const next = mergePluginRefBag(session.pluginRefs, ownerId, sanitized);
    if (next === null) {
      console.warn(
        `[plugin-refs] dropped ref from plugin "${ownerId}" for ${sessionId}: not JSON-plain or over ${PLUGIN_REF_BAG_MAX_BYTES} bytes`,
      );
      return {};
    }
    update.pluginRefs = next;
  }
  deps.sessionManager.update(sessionId, update as Partial<DashboardSession>);
  return sanitized;
}
