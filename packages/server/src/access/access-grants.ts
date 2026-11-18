/**
 * Path-grant store — the filesystem plane's first grant mechanism.
 *
 * A grant admits a **subtree** that no derived containment anchor covers
 * (`lib/path-containment.ts` layers ①/②). It is deliberately NOT an extra
 * `isAllowed` anchor: `isAllowed` widens every anchor it receives to that
 * anchor's BOUND checkout roots (`checkoutAnchors`), so appending a grant for
 * `…/repo/sub` would silently admit all of `…/repo` (design D1). Grants are
 * evaluated by a dedicated subtree predicate *after* `isAllowed` returns false.
 *
 * Invariants, each a test:
 *   - **Subject is a realpath, captured at grant time** (D2). Storing a lexical
 *     path would bind the grant to a symlink (`/wt/current`) and follow it
 *     wherever it was later repointed, with no new approval.
 *   - **Subject is a directory.** A file path is stored as its `dirname`.
 *   - **Absent or malformed store → empty.** Never throws.
 *   - **Capped at 200 per scope**, oldest-`grantedAt` evicted within that scope
 *     only (D10). A union cap would let an ephemeral session grant delete a
 *     persisted project grant from disk.
 *   - **Loaded once into memory**, invalidated on write; the containment path
 *     never reads the store synchronously (D16). An empty store short-circuits
 *     with zero syscalls, which is what makes D9's "byte-identical with an empty
 *     store" true of cost as well as outcome.
 *   - **A failed write is non-fatal**: the subject stays ungranted, the failure
 *     is logged, and the caller is told (D11) so the UI cannot claim a grant
 *     that does not exist. The admitted set never widens on a failed write.
 *   - **Writes are atomic** (temp + rename). A crash mid-write must not truncate
 *     the store, because this store's own malformed→empty rule would then
 *     silently discard every project grant.
 *
 * `session` scope means the SERVER PROCESS, not the pi session whose denial
 * produced it (D17): one grant widens the grant layer for every session and
 * every connected client. `origin` records which session's denial produced it.
 *
 * SINGLE WRITER (accepted trade-off). The store is loaded once and every write
 * rewrites the whole file, so two server processes sharing one path (an explicit
 * `PI_ACCESS_GRANTS_STORE`, or dev + docker pointed at one `$HOME`) silently drop
 * each other's grants. The dashboard is one server per machine and the override
 * exists for tests, so no lock is taken; see design.md D-format-1.
 *
 * **Rows this build does not admit are preserved** (harden-agent-tool-guards D7). A persisted row
 * that is now forbidden (a credential dir, or a directory containing one), unrecognised or of
 * another scope is kept as a raw side list and written back verbatim after the admitted grants by
 * BOTH writers (`recordGrant`, `revokeGrant`), so reverting the build restores it. The cap counts
 * admitted grants only. Whole-file states: invalid JSON / no `grants` / `version !== 1` is moved aside
 * to `<file>.corrupt-<UTC ts>` by `recordGrant` before a fresh store is written (`revokeGrant` writes
 * nothing); a file over `GRANT_STORE_MAX_BYTES` is neither loaded nor rewritten.
 *
 * See change: add-access-grants-and-review; harden-agent-tool-guards.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import {
  forbiddenGrantSubjects,
  isUngrantableSubject,
} from "./forbidden-subjects.js";

/**
 * Notified after a PERSISTED grant is written or revoked. Feeds the pi-trust
 * mirror snapshot; set once by the server. See change: mirror-dashboard-trust-to-pi.
 */
let grantsChanged: (() => void) | undefined;
export function setGrantsChangedListener(fn: (() => void) | undefined): void {
  grantsChanged = fn;
}
function notifyGrantsChanged(): void {
  try {
    grantsChanged?.();
  } catch {
    /* a listener never fails a grant */
  }
}

/**
 * Notified SYNCHRONOUSLY when the in-memory session grants change. Separate from
 * {@link setGrantsChangedListener} (persisted writes only). Feeds the pi-trust
 * live count. See change: mirror-dashboard-trust-live-remote.
 */
let sessionGrantsChanged: (() => void) | undefined;
export function setSessionGrantsChangedListener(fn: (() => void) | undefined): void {
  sessionGrantsChanged = fn;
}
function notifySessionGrantsChanged(): void {
  try {
    sessionGrantsChanged?.();
  } catch {
    /* a listener never fails a grant */
  }
}

/** `session` = in-memory, until server restart. `project` = persisted JSON. */
export type GrantScope = "session" | "project";

/** Which write path produced a grant (absent = the Access page's grant route). */
type GrantVia = "prompt" | "agent-prompt" | "provision";

/**
 * Access mode of a grant. A write grant admits reads AND allowlisted text-document
 * writes under its subtree; a read grant (the default, stored with NO `mode` key)
 * never admits a write. See change: fix-file-link-editor-routing (D2).
 */
type GrantMode = "read" | "write";

/** The mode of an entry: only the exact string `"write"` is a write grant (fail closed). */
function modeOf(g: { mode?: unknown }): GrantMode {
  return g.mode === "write" ? "write" : "read";
}

/** One grant. Session-scoped grants carry the SAME four fields (D17) — not a bare Set. */
export interface AccessGrant {
  /** Directory, realpath'd at grant time (D2). */
  subject: string;
  scope: GrantScope;
  /** Epoch ms. */
  grantedAt: number;
  /** Which session's denial produced this grant. */
  origin: string;
  /**
   * Set when the grant came from the denial's offered-ancestor ladder rather
   * than the denied subject itself, so the Access surface can show both.
   */
  widenedFrom?: string;
  /**
   * `"provision"` = an operator approved a line of a project's provisioning request
   * (change: add-access-provisioning); such a grant is never an eviction victim.
   * `"prompt"` when an operator's allow-always answer to an access prompt wrote
   * this grant (change: add-access-grant-dialog, task 8.2). Absent = the Access
   * page's grant route. Optional and additive: older builds spread it through.
   */
  via?: GrantVia;
  /**
   * `"write"` when the grant also admits allowlisted text-document WRITES under
   * its subtree. Absent = read. Optional and additive on a `version: 1` store
   * (like `via`): an older build spreads it through and treats the entry as a
   * read grant. Derived server-side from the denial's `action`, never from a
   * client field. See change: fix-file-link-editor-routing (D2).
   */
  mode?: "write";
}

/** D10: fixed cap, per scope. */
export const GRANT_CAP_PER_SCOPE = 200;

/**
 * Ceiling on the store file (1 MiB). Bounds the raw rows kept for write-back: a larger file is
 * neither loaded nor rewritten (the write fails, the file stays untouched, one log line).
 */
export const GRANT_STORE_MAX_BYTES = 1_048_576;

interface StoreFile {
  version: 1;
  grants: AccessGrant[];
}

/**
 * Store path. `PI_ACCESS_GRANTS_STORE` overrides it outright so a suite never
 * writes under the real `$HOME`; the dashboard config dir is the default.
 */
export function accessGrantsStorePath(): string {
  const override = process.env.PI_ACCESS_GRANTS_STORE;
  if (override?.trim()) return path.resolve(override);
  return path.join(getDashboardConfigDir(), "access-grants.json");
}

/**
 * In-memory cache. `null` = not yet loaded. Invalidated (set to `null`) on every
 * write so the next read re-loads. Session grants live beside it and are never
 * persisted.
 */
let cache: AccessGrant[] | null = null;
const sessionGrants: AccessGrant[] = [];
/**
 * Rows of the loaded file this build does NOT admit (now-forbidden, unrecognised, wrong scope),
 * as parsed. Written back verbatim after the admitted grants. Empty unless `storeState` is "ok".
 */
let rawRejected: unknown[] = [];
/** "invalid" = bad JSON / no `grants` / `version !== 1`; "oversize" = over `GRANT_STORE_MAX_BYTES`. */
let storeState: "ok" | "invalid" | "oversize" = "ok";
/** Now-forbidden subjects already logged in this process (one line per subject). */
const loggedForbidden = new Set<string>();

/** Test seam: drop the cache and the in-memory session grants (simulates restart). */
export function __resetAccessGrants(): void {
  cache = null;
  sessionGrants.length = 0;
  loadCount = 0;
  rawRejected = [];
  storeState = "ok";
  loggedForbidden.clear();
}

/** Test seam: how many times the store file has been read in this process. */
let loadCount = 0;
export function __accessGrantsLoadCount(): number {
  return loadCount;
}

function emptyStore(): AccessGrant[] {
  return [];
}

/**
 * The store file's text, or `null` when there is none to parse (missing, unreadable, oversize). Oversize
 * sets `storeState`: such a file is not loaded (zero raw rows retained) and never rewritten.
 */
function readStoreText(file: string): string | null {
  // A failing stat (missing / unreadable file) is left to the read below to report.
  try {
    if (fs.statSync(file).size > GRANT_STORE_MAX_BYTES) return markOversizeText();
  } catch {
    /* reported by the read */
  }
  try {
    const raw = fs.readFileSync(file, "utf8");
    return Buffer.byteLength(raw, "utf8") > GRANT_STORE_MAX_BYTES ? markOversizeText() : raw;
  } catch (err) {
    // A MISSING store is the ordinary first-run case and stays quiet. Any other
    // read failure is reported: an unreadable store empties the granted set, and
    // doing that silently would revoke every project grant with no trace.
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn(`[access-grants] store unreadable: ${(err as Error)?.message}`);
    }
    return null;
  }
}

/** Parse the store file; `null` marks it invalid (bad JSON, no `grants`, or a version this build refuses). */
function parseStore(raw: string): StoreFile | null {
  let parsed: StoreFile;
  try {
    parsed = JSON.parse(raw) as StoreFile;
  } catch {
    console.warn("[access-grants] store is not valid JSON — treating as empty");
    return null;
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.grants)) return null;
  // Refuse an unknown version outright. Reading a future file as if it were v1
  // would misinterpret it silently; refusing empties the granted set, which
  // fails CLOSED (narrower, never wider) and is logged.
  if (parsed.version !== 1) {
    console.warn(`[access-grants] unknown store version ${String(parsed.version)} — refusing to read`);
    return null;
  }
  return parsed;
}

/**
 * Split the file's rows into admitted grants and `rawRejected`. The forbidden filter must hold for values
 * ALREADY ON DISK, not only for ones arriving through `recordGrant`. The forbidden list grew, so a store
 * legitimately written by an older build can contain a subject this build must refuse; a store copied
 * between machines can too (a different `$HOME` yields a different `sensitive` set). Without this, a single
 * on-disk `"/"` admits every path on the machine. The sets are built once per load, not once per row.
 */
function admitRows(rows: unknown[]): AccessGrant[] {
  const sets = forbiddenGrantSubjects();
  const valid: AccessGrant[] = [];
  for (const g of rows) {
    if (!isGrantShaped(g)) {
      rawRejected.push(g);
    } else if (isUngrantableSubject(g.subject, undefined, sets)) {
      rawRejected.push(g);
      logNowForbidden(g.subject);
    } else {
      const { mode: rawMode, ...rest } = g;
      // Normalise `mode` fail-closed: only the exact string "write" survives (a hostile or
      // hand-edited value of any other shape is a read grant). No rewrite happens on load.
      valid.push({
        ...rest,
        origin: typeof g.origin === "string" ? g.origin : "unknown",
        ...(rawMode === "write" ? { mode: "write" as const } : {}),
      });
    }
  }
  return valid;
}

/** Absent, unreadable or malformed → empty (never throws). Sets `rawRejected` / `storeState`. */
function loadFromDisk(): AccessGrant[] {
  loadCount += 1;
  rawRejected = [];
  storeState = "ok";
  const raw = readStoreText(accessGrantsStorePath());
  if (raw === null) return emptyStore();
  const parsed = parseStore(raw);
  if (!parsed) return markInvalid();
  const valid = admitRows(parsed.grants as unknown[]);
  // The cap is a property of the STORE, not of the write path: a hand-edited or
  // hostile file with 100k grants would otherwise be admitted in full, growing
  // the hot path's Set per request and memory without bound. It counts ADMITTED
  // grants only (preserved rows do not cause eviction).
  // Load does not spare provisioned grants: the bound wins, so a hostile file
  // full of `via: "provision"` entries still cannot grow the Set.
  enforceCap(valid, "project");
  return valid;
}

function markOversizeText(): null {
  storeState = "oversize";
  console.warn(`[access-grants] store exceeds ${GRANT_STORE_MAX_BYTES} bytes — not loaded, not rewritten`);
  return null;
}

function markInvalid(): AccessGrant[] {
  storeState = "invalid";
  return emptyStore();
}

/** One log line per now-forbidden subject per process; the subject path only. */
function logNowForbidden(subject: string): void {
  if (loggedForbidden.has(subject)) return;
  loggedForbidden.add(subject);
  console.warn(`[access-grants] grant subject=${JSON.stringify(subject)} is forbidden by this build: not admitted, kept in the store`);
}

/**
 * A row this build can admit structurally. Only `project` scope is persisted: accepting a `session`
 * entry would resurrect it across restarts (contradicting "session = until server restart") and
 * leave it unrevocable through the scoped API. `NaN`/`Infinity` pass a bare `typeof` check and
 * would poison the eviction sort, so `grantedAt` must be finite.
 */
function isGrantShaped(g: unknown): g is AccessGrant {
  if (!g || typeof g !== "object") return false;
  const r = g as Record<string, unknown>;
  return (
    typeof r.subject === "string" &&
    r.subject.length > 0 &&
    r.scope === "project" &&
    typeof r.grantedAt === "number" &&
    Number.isFinite(r.grantedAt)
  );
}

/** Serialise the store: admitted grants, then every preserved raw row, unchanged. */
function serializeStore(admitted: AccessGrant[]): string {
  return JSON.stringify({ version: 1, grants: [...admitted, ...rawRejected] }, null, 2);
}

/**
 * Whole-file states before a WRITE. `oversize` → refuse (file untouched). `invalid` → move the old
 * file aside to `<file>.corrupt-<UTC ts>` (never overwrite it); a failed move refuses the write.
 */
function prepareStoreWrite(): { ok: true } | { ok: false; error: string } {
  const file = accessGrantsStorePath();
  if (storeState === "oversize") {
    console.warn(`[access-grants] store exceeds ${GRANT_STORE_MAX_BYTES} bytes — write refused`);
    return { ok: false, error: "store too large" };
  }
  if (storeState === "invalid") {
    const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const aside = `${file}.corrupt-${ts}`;
    try {
      fs.renameSync(file, aside);
    } catch (err) {
      console.warn(`[access-grants] could not move the unusable store aside: ${(err as Error)?.message}`);
      return { ok: false, error: "store unusable" };
    }
    console.warn(`[access-grants] unusable store moved aside to ${aside}`);
    storeState = "ok";
    rawRejected = [];
  }
  return { ok: true };
}

/** Cached persisted grants. Never reads on a warm cache — this is the containment path. */
function persisted(): AccessGrant[] {
  if (cache === null) cache = loadFromDisk();
  return cache;
}

/**
 * Resolve symlinks in the nearest existing ancestor of `p` and re-append the
 * tail, so a missing path still resolves its real (symlink-collapsed) prefix.
 * Local to this module on purpose: importing `lib/path-containment` here would
 * create a cycle, since the grant predicate lives there.
 */
function realpathNearestAncestor(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(realpathNearestAncestor(parent), path.basename(p));
  }
}

/**
 * Normalise a grant subject: absolute, symlink-resolved at grant time (D2), and
 * a directory — an existing non-directory is stored as its `dirname` (task 1.5).
 */
export function normalizeGrantSubject(input: string): string {
  const real = realpathNearestAncestor(path.resolve(input));
  try {
    if (!fs.statSync(real).isDirectory()) return path.dirname(real);
  } catch {
    /* missing → keep the directory-shaped path */
  }
  return real;
}

/** Persisted project grants, then in-memory session grants. */
export function listGrants(): AccessGrant[] {
  return [...persisted(), ...sessionGrants];
}

/**
 * Every distinct subject currently granted — the predicate's input. Purely
 * in-memory (one lazy disk load at most), so the containment hot path performs
 * no syscall of its own (D16).
 */
export function grantedSubjects(): string[] {
  const seen = new Set<string>();
  for (const g of persisted()) seen.add(g.subject);
  for (const g of sessionGrants) seen.add(g.subject);
  return [...seen];
}

/**
 * Subjects of WRITE grants only — the write predicate's input. `grantedSubjects()`
 * (the read predicate) includes these (write ⊃ read); a read grant never appears here.
 */
export function grantedWriteSubjects(): string[] {
  const seen = new Set<string>();
  for (const g of persisted()) if (modeOf(g) === "write") seen.add(g.subject);
  for (const g of sessionGrants) if (modeOf(g) === "write") seen.add(g.subject);
  return [...seen];
}

/**
 * Evict oldest-by-`grantedAt` down to `GRANT_CAP_PER_SCOPE` for `scope` only.
 * Ties on `grantedAt` break by insertion order (array order), so eviction is
 * deterministic (D10).
 *
 * `protect` — the grant being recorded right now — is never evicted. It is the
 * most recent by construction, but a rolled-back clock or a future-dated entry
 * already in the file could make it sort oldest, and evicting it would let
 * `recordGrant` return `ok: true` for a grant that was never persisted: the UI
 * would claim a grant that does not exist, the exact failure D11 forbids.
 *
 * `spareProvisioned` — `via: "provision"` grants are never victims (change:
 * add-access-provisioning, D5). Returns `false` and mutates nothing when the
 * excess cannot be fully evicted (`evict: false`, or every candidate spared).
 * Every eviction is logged.
 */
function enforceCap(
  grants: AccessGrant[],
  scope: GrantScope,
  opts: { protect?: AccessGrant; evict?: boolean; spareProvisioned?: boolean } = {},
): boolean {
  const inScope = grants.filter((g) => g.scope === scope);
  if (inScope.length <= GRANT_CAP_PER_SCOPE) return true;
  if (opts.evict === false) return false;
  const excess = inScope.length - GRANT_CAP_PER_SCOPE;
  const evictOrder = inScope
    .filter((g) => g !== opts.protect && !(opts.spareProvisioned && g.via === "provision"))
    .map((g, i) => ({ g, i }))
    .sort((a, b) => a.g.grantedAt - b.g.grantedAt || a.i - b.i)
    .slice(0, excess)
    .map((x) => x.g);
  if (evictOrder.length < excess) return false;
  const doomed = new Set(evictOrder);
  for (let i = grants.length - 1; i >= 0; i -= 1) {
    if (doomed.has(grants[i])) grants.splice(i, 1);
  }
  for (const g of evictOrder) {
    console.warn(`[access-grants] evicted subject=${JSON.stringify(g.subject)} via=${g.via ?? "none"}`);
  }
  return true;
}

/** Atomic write: temp file in the same directory, then rename (D11). */
function writeAtomic(target: string, contents: string): void {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, contents, "utf8");
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
    throw err;
  }
}

export type RecordGrantResult =
  | { ok: true; grant: AccessGrant }
  | { ok: false; error: string };

export interface RecordGrantInput {
  /** Raw subject as requested; normalised here (realpath + directory rule). */
  subject: string;
  scope?: GrantScope;
  origin?: string;
  /** Set when the subject came from the denial's offered-ancestor ladder. */
  widenedFrom?: string;
  via?: GrantVia;
  /** `"write"` records a write grant; anything else a read grant (no `mode` stored). */
  mode?: GrantMode;
  /**
   * `false` = refuse with `{ok:false, error:"capacity"}` at the cap instead of
   * evicting the oldest grant (change: add-access-provisioning). Default `true`.
   */
  evict?: boolean;
  now?: number;
}

/**
 * Record a grant. Idempotent per `(subject, scope, mode)`: a write grant is a second
 * entry beside a read grant for the same directory, revocable independently.
 *
 * On a **write failure** the subject is left UNGRANTED and the failure is
 * returned, never thrown (D11): the request that triggered the denial still 403s
 * exactly as it would have, and the surface that asked can report that the grant
 * did not stick.
 */
/** A grant with its optional provenance fields set only when present. */
function buildGrant(
  base: AccessGrant,
  widenedFrom: string | undefined,
  via: GrantVia | undefined,
  mode: GrantMode,
): AccessGrant {
  const grant: AccessGrant = { ...base };
  if (widenedFrom) grant.widenedFrom = widenedFrom;
  if (via) grant.via = via;
  if (mode === "write") grant.mode = "write";
  return grant;
}

export function recordGrant(input: RecordGrantInput): RecordGrantResult {
  const scope: GrantScope = input.scope ?? "project";
  const origin = input.origin ?? "unknown";
  const subject = normalizeGrantSubject(input.subject);
  const grantedAt = input.now ?? Date.now();
  const mode: GrantMode = input.mode === "write" ? "write" : "read";

  // Defence in depth (design D15): the forbidden filter must run on the value
  // that is actually STORED, never on the caller's pre-normalization input.
  // `normalizeGrantSubject` maps a non-directory onto its containing directory,
  // so a caller that validated a FILE subject would otherwise persist a grant
  // for that file's parent: on macOS a denial naming `$HOME/.CFUserTextEncoding`
  // normalized into a grant for `$HOME`, and `/.file` into a grant for `/`.
  // `access-routes` applies the same filter post-normalization; this is the
  // backstop that makes the invariant hold for any future caller.
  if (isUngrantableSubject(subject)) {
    return { ok: false, error: "forbidden subject" };
  }

  const widen =
    input.widenedFrom && normalizeGrantSubject(input.widenedFrom) !== subject
      ? normalizeGrantSubject(input.widenedFrom)
      : undefined;

  if (scope === "session") {
    const existing = sessionGrants.find((g) => g.subject === subject && modeOf(g) === mode);
    if (existing) return { ok: true, grant: existing };
    const grant = buildGrant({ subject, scope, grantedAt, origin }, widen, input.via, mode);
    sessionGrants.push(grant);
    if (!enforceCap(sessionGrants, "session", { protect: grant, evict: input.evict, spareProvisioned: true })) {
      sessionGrants.pop();
      return { ok: false, error: "capacity" };
    }
    notifySessionGrantsChanged();
    return { ok: true, grant };
  }

  return recordProjectGrant(subject, mode, buildGrant({ subject, scope, grantedAt, origin }, widen, input.via, mode), input.evict);
}

/** The persisted (`project`) scope of `recordGrant`: cap, whole-file state, atomic write-back with the preserved rows. */
function recordProjectGrant(
  subject: string,
  mode: GrantMode,
  grant: AccessGrant,
  evict: boolean | undefined,
): RecordGrantResult {
  const grants = [...persisted()];
  const existing = grants.find((g) => g.subject === subject && modeOf(g) === mode);
  if (existing) return { ok: true, grant: existing };
  grants.push(grant);
  if (!enforceCap(grants, "project", { protect: grant, evict, spareProvisioned: true })) {
    return { ok: false, error: "capacity" };
  }

  const prepared = prepareStoreWrite();
  if (!prepared.ok) return { ok: false, error: prepared.error };
  const text = serializeStore(grants);
  if (Buffer.byteLength(text) > GRANT_STORE_MAX_BYTES) {
    // The reader refuses a store over the ceiling: committing this would make every grant vanish on the next start.
    console.warn(`[access-grants] store would exceed ${GRANT_STORE_MAX_BYTES} bytes — write refused`);
    return { ok: false, error: "store too large" };
  }
  try {
    writeAtomic(accessGrantsStorePath(), text);
  } catch (err) {
    // Not recorded. Cache untouched, so the admitted set cannot widen (D11).
    console.warn(`[access-grants] failed to persist grant for ${subject}: ${(err as Error)?.message}`);
    return { ok: false, error: (err as Error)?.message ?? "write failed" };
  }
  cache = grants;
  notifyGrantsChanged();
  return { ok: true, grant };
}

/**
 * Revoke by subject, or by subject+scope, optionally by mode. Returns whether anything
 * was removed. A persisted revoke invalidates the in-memory cache, which is what makes
 * revocation take effect on the next request with no restart (D16).
 *
 * `mode` omitted (`undefined`) removes every entry for the subject (today's behaviour);
 * `"write"` / `"read"` remove only that mode's entry; any OTHER value removes nothing
 * (callers that take it from a request validate first and answer 400).
 */
export function revokeGrant(subject: string, scope?: GrantScope, mode?: unknown): boolean {
  if (mode !== undefined && mode !== "read" && mode !== "write") return false;
  const target = normalizeGrantSubject(subject);
  const matches = (g: AccessGrant): boolean => g.subject === target && (mode === undefined || modeOf(g) === mode);
  let removed = false;

  if (scope !== "project") {
    let sessionRemoved = false;
    for (let i = sessionGrants.length - 1; i >= 0; i -= 1) {
      if (matches(sessionGrants[i])) {
        sessionGrants.splice(i, 1);
        removed = true;
        sessionRemoved = true;
      }
    }
    if (sessionRemoved) notifySessionGrantsChanged();
  }
  if (scope === "session") return removed;

  const grants = persisted();
  const kept = grants.filter((g) => !matches(g));
  if (kept.length === grants.length) return removed;
  // Nothing was admitted from an unusable / oversize file, so there is nothing to revoke (and
  // `kept` can only differ from `grants` for a usable store): a revoke never writes such a file.
  if (storeState !== "ok") return removed;
  try {
    writeAtomic(accessGrantsStorePath(), serializeStore(kept));
  } catch (err) {
    console.warn(
      `[access-grants] failed to persist revoke for ${target}: ${(err as Error)?.message}`,
    );
    return false;
  }
  cache = kept;
  notifyGrantsChanged();
  return true;
}
