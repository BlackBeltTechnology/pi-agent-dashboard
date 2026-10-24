/**
 * Plain-text API keys left in pi's global `settings.json` — detection (masked)
 * and the move-to-auth.json / remove cleanup.
 *
 * Legacy keys: `anthropicApiKey`, `openaiApiKey`, `providers.<id>.apiKey`, and a
 * providerless top-level `apiKey`. Each reports the state of auth.json for its
 * provider — `none` (nothing stored), `same` (an API-key credential with exactly
 * this value, compared with `timingSafeEqual`), `different` (an OAuth login, a
 * different key, or an auth.json that cannot be relied on). Only the MASKED
 * value ever leaves this module; the apply path keeps values in memory.
 *
 * Neither lock may be held across the other (both critical sections are
 * synchronous), so `applyLegacyCredentialActions` runs three phases:
 *   1. plan   — settings lock, no write: token check, validate, resolve values;
 *   2. writes — one auth.json lock per move (`writeCredentialIfAbsent`);
 *   3. delete — settings lock, token re-check, delete the planned keys.
 * No path deletes the last copy of a value: the settings key goes only after the
 * auth.json write succeeded, and a changed settings.json makes the token stale.
 *
 * See change: pi-settings-full-coverage (design D4, D5a, D5b).
 */
import { timingSafeEqual } from "node:crypto";
import type { PiLegacyAuthState, PiLegacyCredential } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import {
  type FsDeps,
  formatJson,
  type PiSettingsState,
  readPiSettings,
  withPiSettingsLock,
} from "../pi-agent-settings.js";
import { auditLine, auditPrefix } from "./audit-log.js";
import {
  type AuthData,
  CredentialTypeConflictError,
  readAuthSnapshotLocked,
  resolveAuthJsonKey,
  tryReadAuthJson,
  writeCredentialIfAbsent,
} from "./provider-auth-storage.js";
import { PI_RENAMED_PROVIDER_IDS } from "./scan-legacy-provider-ids.js";

export interface AuthSnapshot {
  data: AuthData;
  /** Unparseable (or unreadable) — nothing in `data` can be relied on. */
  corrupt: boolean;
}

/** `…last4` for 32+ characters, otherwise fully masked. */
export function maskSecret(value: string): string {
  return value.length >= 32 ? `…${value.slice(-4)}` : "••••";
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const isSecret = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** A legacy key as found in settings.json (internal: carries the VALUE). */
interface LegacyKey {
  key: string;
  /** Path of the value inside settings.json. */
  path: readonly string[];
  provider: string | null;
  value: string;
}

const RENAMED: ReadonlyMap<string, string> = new Map(Object.entries(PI_RENAMED_PROVIDER_IDS));
const PRE_RENAME_IDS: ReadonlyMap<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [oldId, newId] of RENAMED) m.set(newId, [...(m.get(newId) ?? []), oldId]);
  return m;
})();

/** Provider id as Settings → Providers stores it: pi renames applied, then `<id>-api` unwrapped. */
function normaliseProvider(id: string): string {
  return resolveAuthJsonKey(RENAMED.get(id) ?? id);
}

function findLegacyKeys(settings: Record<string, unknown>): LegacyKey[] {
  const out: LegacyKey[] = [];
  if (isSecret(settings.anthropicApiKey)) {
    out.push({ key: "anthropicApiKey", path: ["anthropicApiKey"], provider: "anthropic", value: settings.anthropicApiKey });
  }
  if (isSecret(settings.openaiApiKey)) {
    out.push({ key: "openaiApiKey", path: ["openaiApiKey"], provider: "openai", value: settings.openaiApiKey });
  }
  if (isSecret(settings.apiKey)) out.push({ key: "apiKey", path: ["apiKey"], provider: null, value: settings.apiKey });
  if (isPlainObject(settings.providers)) {
    for (const [id, entry] of Object.entries(settings.providers)) {
      if (isPlainObject(entry) && isSecret(entry.apiKey)) {
        out.push({
          key: `providers.${id}.apiKey`,
          path: ["providers", id, "apiKey"],
          provider: normaliseProvider(id),
          value: entry.apiKey,
        });
      }
    }
  }
  return out;
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function authState(provider: string | null, value: string, auth: AuthSnapshot | null): PiLegacyAuthState {
  if (provider === null || !auth || auth.corrupt) return "different";
  if (Object.hasOwn(auth.data, provider)) {
    const stored = auth.data[provider];
    return stored?.type === "api_key" && typeof stored.key === "string" && sameSecret(stored.key, value) ? "same" : "different";
  }
  // A credential still stored under the pre-rename id is not "nothing stored".
  return (PRE_RENAME_IDS.get(provider) ?? []).some((old) => Object.hasOwn(auth.data, old)) ? "different" : "none";
}

/** Masked, value-free list for the read response. `auth` null = unreadable → every key `different`. */
export function detectLegacyCredentials(settings: Record<string, unknown>, auth: AuthSnapshot | null): PiLegacyCredential[] {
  return findLegacyKeys(settings).map((k) => ({
    key: k.key,
    provider: k.provider,
    auth: authState(k.provider, k.value, auth),
    masked: maskSecret(k.value),
  }));
}

/** Unlocked, non-quarantining auth.json read for display; `null` when unreadable or unparseable. */
export function readAuthSnapshotUnlocked(): AuthSnapshot | null {
  try {
    const data = tryReadAuthJson();
    return data ? { data, corrupt: false } : null;
  } catch {
    return null;
  }
}

/** `settings` without any legacy credential value (responses of the legacy endpoint never carry one). */
export function withoutLegacyValues(settings: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...settings };
  for (const k of findLegacyKeys(settings)) deletePath(out, k.path);
  return out;
}

/** Delete `path` from a (shallow-copied as it goes) settings object and prune emptied `providers.<id>` / `providers`. */
function deletePath(root: Record<string, unknown>, path: readonly string[]): void {
  if (path.length === 1) {
    delete root[path[0]];
    return;
  }
  const [head, id, leaf] = path;
  const block = root[head];
  if (!isPlainObject(block)) return;
  const entry = block[id];
  if (!isPlainObject(entry)) return;
  const nextEntry = { ...entry };
  delete nextEntry[leaf];
  const nextBlock = { ...block };
  if (Object.keys(nextEntry).length === 0) delete nextBlock[id];
  else nextBlock[id] = nextEntry;
  if (Object.keys(nextBlock).length === 0) delete root[head];
  else root[head] = nextBlock;
}

export interface LegacyAction {
  key: string;
  action: "move" | "remove";
}

export type LegacyApplyResult =
  | { ok: true; state: PiSettingsState; legacy: PiLegacyCredential[] }
  | { ok: false; error: "invalid"; message: string; legacy: PiLegacyCredential[] }
  | { ok: false; error: "stale"; state: PiSettingsState; legacy: PiLegacyCredential[] }
  | { ok: false; error: "conflict"; message: string; legacy: PiLegacyCredential[] }
  | { ok: false; error: "parse"; parseError: string }
  | { ok: false; error: "busy" }
  | { ok: false; error: "io"; message: string; legacy?: PiLegacyCredential[] };

interface Plan {
  moves: (LegacyKey & { provider: string })[];
  deletes: LegacyKey[];
}

type PlanFail = { message: string };

type Planned = { plan: Plan } | { fail: PlanFail };

/** One action against the current state: the resolved key, or a failure message. Never echoes a value. */
function checkAction(a: LegacyAction, k: LegacyKey | undefined, auth: AuthSnapshot | null): string | null {
  if (!k) return `${a.key} is not present in settings.json`;
  const state = authState(k.provider, k.value, auth);
  if (a.action === "move") {
    if (k.provider === null) return `${a.key} has no provider and cannot be moved`;
    return state === "none" ? null : `${a.key}: Providers already holds a credential for ${k.provider}`;
  }
  if (a.action === "remove") return state === "same" ? null : `${a.key} can only be removed when auth.json holds the same key`;
  return `unknown action for ${a.key}`;
}

/** Validate the actions against settings + auth. Pure; never throws, never echoes a value. */
function planActions(
  settings: Record<string, unknown>,
  actions: readonly LegacyAction[],
  auth: AuthSnapshot | null,
): Planned {
  const keys = new Map(findLegacyKeys(settings).map((k) => [k.key, k]));
  const moves: Plan["moves"] = [];
  const deletes: LegacyKey[] = [];
  const seenKeys = new Set<string>();
  const seenProviders = new Set<string>();
  for (const a of actions) {
    const k = keys.get(a.key);
    const problem = checkAction(a, k, auth);
    if (problem || !k) return { fail: { message: problem ?? `${a.key} is not present in settings.json` } };
    if (seenKeys.has(a.key)) return { fail: { message: `${a.key} appears twice in the request` } };
    seenKeys.add(a.key);
    if (a.action === "remove") {
      deletes.push(k);
      continue;
    }
    const provider = k.provider as string; // `checkAction` guarantees a provider for a move
    if (seenProviders.has(provider)) return { fail: { message: `more than one key resolves to provider ${provider}` } };
    seenProviders.add(provider);
    moves.push({ ...k, provider });
  }
  return { plan: { moves, deletes: [...deletes, ...moves] } };
}

/** Refreshed masked list from the current disk state (best effort; never throws). */
function currentLegacy(deps: FsDeps): PiLegacyCredential[] {
  try {
    return detectLegacyCredentials(readPiSettings(deps).settings, readAuthSnapshotUnlocked());
  } catch {
    return [];
  }
}

type PlanPhase = { ok: true; plan: Plan } | { ok: false; result: LegacyApplyResult };

/** Phase 1 — plan under the settings lock (no write). */
async function planPhase(
  actions: readonly LegacyAction[],
  baseEtag: string,
  deps: FsDeps,
): Promise<PlanPhase> {
  // auth.json is read first (async lock) so the settings critical section stays synchronous.
  let auth: AuthSnapshot | null;
  try {
    auth = await readAuthSnapshotLocked();
  } catch {
    auth = null; // unreadable → every key `different`: nothing moves, nothing is removed
  }
  const planned = await withPiSettingsLock<Plan, PlanFail | { parseError: string }>(
    (state) => {
      if (state.parseError) return { fail: { parseError: state.parseError } };
      const p = planActions(state.settings, actions, auth);
      return "fail" in p ? { fail: p.fail } : { value: p.plan };
    },
    { baseEtag },
    deps,
  );
  if (planned.ok) return { ok: true, plan: planned.value };
  const legacy = currentLegacy(deps);
  let result: LegacyApplyResult;
  if (planned.error === "stale") result = { ok: false, error: "stale", state: planned.state, legacy };
  else if (planned.error === "busy") result = { ok: false, error: "busy" };
  else if (planned.error === "io") result = { ok: false, error: "io", message: "Could not read settings.json", legacy };
  else if ("parseError" in planned.fail) result = { ok: false, error: "parse", parseError: planned.fail.parseError };
  else result = { ok: false, error: "invalid", message: planned.fail.message, legacy };
  return { ok: false, result };
}

/** Phase 2 — auth.json writes, one lock each. A credential that appeared since the plan stops everything. */
async function writePhase(moves: Plan["moves"], deps: FsDeps): Promise<LegacyApplyResult | null> {
  for (const m of moves) {
    try {
      const r = await writeCredentialIfAbsent(m.provider, { type: "api_key", key: m.value });
      if (r === "exists") {
        return { ok: false, error: "conflict", message: `Providers already holds a credential for ${m.provider}`, legacy: currentLegacy(deps) };
      }
      // System writer (no request here): provider id only, never the key (D2).
      auditLine("provider-auth", "legacy_migrated", { provider: auditPrefix(m.provider, 64), actor: "system" });
    } catch (err) {
      const legacy = currentLegacy(deps);
      if (err instanceof CredentialTypeConflictError) {
        return { ok: false, error: "conflict", message: `Providers already holds a credential for ${m.provider}`, legacy };
      }
      return { ok: false, error: "io", message: "Could not write auth.json", legacy };
    }
  }
  return null;
}

/** Phase 3 — delete from settings.json (token re-checked under the lock). */
async function deletePhase(deletes: readonly LegacyKey[], baseEtag: string, deps: FsDeps): Promise<LegacyApplyResult> {
  const written = await withPiSettingsLock<null, { parseError: string }>(
    (state) => {
      if (state.parseError) return { fail: { parseError: state.parseError } };
      const next: Record<string, unknown> = { ...state.settings };
      for (const k of deletes) deletePath(next, k.path);
      return { value: null, write: formatJson(next) };
    },
    { baseEtag },
    deps,
  );
  if (written.ok) return { ok: true, state: written.state, legacy: currentLegacy(deps) };
  if (written.error === "stale") return { ok: false, error: "stale", state: written.state, legacy: currentLegacy(deps) };
  if (written.error === "fn") return { ok: false, error: "parse", parseError: written.fail.parseError };
  if (written.error === "busy") return { ok: false, error: "busy" };
  return { ok: false, error: "io", message: "Could not write settings.json", legacy: currentLegacy(deps) };
}

export async function applyLegacyCredentialActions(
  actions: readonly LegacyAction[],
  baseEtag: string,
  deps: FsDeps = {},
): Promise<LegacyApplyResult> {
  const planned = await planPhase(actions, baseEtag, deps);
  if (!planned.ok) return planned.result;
  const failed = await writePhase(planned.plan.moves, deps);
  if (failed) return failed;
  return deletePhase(planned.plan.deletes, baseEtag, deps);
}
