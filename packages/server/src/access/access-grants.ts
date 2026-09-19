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
 * See change: add-access-grants-and-review.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";

/** `session` = in-memory, until server restart. `project` = persisted JSON. */
export type GrantScope = "session" | "project";

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
}

/** D10: fixed cap, per scope. */
export const GRANT_CAP_PER_SCOPE = 200;

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
  if (override && override.trim()) return path.resolve(override);
  return path.join(getDashboardConfigDir(), "access-grants.json");
}

/**
 * In-memory cache. `null` = not yet loaded. Invalidated (set to `null`) on every
 * write so the next read re-loads. Session grants live beside it and are never
 * persisted.
 */
let cache: AccessGrant[] | null = null;
const sessionGrants: AccessGrant[] = [];

/** Test seam: drop the cache and the in-memory session grants (simulates restart). */
export function __resetAccessGrants(): void {
  cache = null;
  sessionGrants.length = 0;
  loadCount = 0;
}

/** Test seam: how many times the store file has been read in this process. */
let loadCount = 0;
export function __accessGrantsLoadCount(): number {
  return loadCount;
}

function emptyStore(): AccessGrant[] {
  return [];
}

/** Absent, unreadable or malformed → empty (never throws). */
function loadFromDisk(): AccessGrant[] {
  loadCount += 1;
  try {
    const raw = fs.readFileSync(accessGrantsStorePath(), "utf8");
    const parsed = JSON.parse(raw) as StoreFile;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.grants)) return emptyStore();
    return parsed.grants.filter(
      (g): g is AccessGrant =>
        !!g &&
        typeof g === "object" &&
        typeof g.subject === "string" &&
        g.subject.length > 0 &&
        (g.scope === "session" || g.scope === "project") &&
        typeof g.grantedAt === "number",
    );
  } catch {
    return emptyStore();
  }
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
 * Evict oldest-by-`grantedAt` down to `GRANT_CAP_PER_SCOPE` for `scope` only.
 * Ties on `grantedAt` break by insertion order (array order), so eviction is
 * deterministic (D10).
 */
function enforceCap(grants: AccessGrant[], scope: GrantScope): void {
  const inScope = grants.filter((g) => g.scope === scope);
  if (inScope.length <= GRANT_CAP_PER_SCOPE) return;
  const excess = inScope.length - GRANT_CAP_PER_SCOPE;
  const evictOrder = inScope
    .map((g, i) => ({ g, i }))
    .sort((a, b) => a.g.grantedAt - b.g.grantedAt || a.i - b.i)
    .slice(0, excess)
    .map((x) => x.g);
  const doomed = new Set(evictOrder);
  for (let i = grants.length - 1; i >= 0; i -= 1) {
    if (doomed.has(grants[i])) grants.splice(i, 1);
  }
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
  now?: number;
}

/**
 * Record a grant. Idempotent on an already-granted subject.
 *
 * On a **write failure** the subject is left UNGRANTED and the failure is
 * returned, never thrown (D11): the request that triggered the denial still 403s
 * exactly as it would have, and the surface that asked can report that the grant
 * did not stick.
 */
export function recordGrant(input: RecordGrantInput): RecordGrantResult {
  const scope: GrantScope = input.scope ?? "project";
  const origin = input.origin ?? "unknown";
  const subject = normalizeGrantSubject(input.subject);
  const grantedAt = input.now ?? Date.now();

  const widen =
    input.widenedFrom && normalizeGrantSubject(input.widenedFrom) !== subject
      ? normalizeGrantSubject(input.widenedFrom)
      : undefined;

  if (scope === "session") {
    const existing = sessionGrants.find((g) => g.subject === subject);
    if (existing) return { ok: true, grant: existing };
    const grant: AccessGrant = { subject, scope, grantedAt, origin };
    if (widen) grant.widenedFrom = widen;
    sessionGrants.push(grant);
    enforceCap(sessionGrants, "session");
    return { ok: true, grant };
  }

  const grants = [...persisted()];
  const existing = grants.find((g) => g.subject === subject);
  if (existing) return { ok: true, grant: existing };
  const grant: AccessGrant = { subject, scope, grantedAt, origin };
  if (widen) grant.widenedFrom = widen;
  grants.push(grant);
  enforceCap(grants, "project");

  const file: StoreFile = { version: 1, grants };
  try {
    writeAtomic(accessGrantsStorePath(), JSON.stringify(file, null, 2));
  } catch (err) {
    // Not recorded. Cache untouched, so the admitted set cannot widen (D11).
    console.warn(
      `[access-grants] failed to persist grant for ${subject}: ${(err as Error)?.message}`,
    );
    return { ok: false, error: (err as Error)?.message ?? "write failed" };
  }
  cache = grants;
  return { ok: true, grant };
}

/**
 * Revoke by subject, or by subject+scope. Returns whether anything was removed.
 * A persisted revoke invalidates the in-memory cache, which is what makes
 * revocation take effect on the next request with no restart (D16).
 */
export function revokeGrant(subject: string, scope?: GrantScope): boolean {
  const target = normalizeGrantSubject(subject);
  let removed = false;

  if (scope !== "project") {
    for (let i = sessionGrants.length - 1; i >= 0; i -= 1) {
      if (sessionGrants[i].subject === target) {
        sessionGrants.splice(i, 1);
        removed = true;
      }
    }
  }
  if (scope === "session") return removed;

  const grants = persisted();
  const kept = grants.filter((g) => g.subject !== target);
  if (kept.length === grants.length) return removed;
  try {
    writeAtomic(accessGrantsStorePath(), JSON.stringify({ version: 1, grants: kept } satisfies StoreFile, null, 2));
  } catch (err) {
    console.warn(
      `[access-grants] failed to persist revoke for ${target}: ${(err as Error)?.message}`,
    );
    return false;
  }
  cache = kept;
  return true;
}
