/**
 * Canonical folder-admission guard shared by first-party plugins that accept a
 * caller-supplied `cwd` and then touch disk under it (kb-plugin, mcp-client).
 *
 * A cwd is admitted when it — or the resolved MAIN CHECKOUT of the git
 * repository it belongs to — is a member of the host's known-folder set
 * (session cwds ∪ pinned dirs). Both sides are realpath-canonicalized, so a
 * symlinked route to the same folder matches, and a git worktree whose main
 * checkout is known is admitted even though the worktree itself is never
 * pinned (worktrees are transient; the durable repo root is the trust anchor).
 *
 * Extracted from `packages/kb-plugin/src/server/kb-routes.ts` so both plugins
 * import ONE implementation. See change: extract-mcp-client-plugin.
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import {
  bindCheckoutClassifiedAsync,
  type ClassifiedGitOptions,
  checkoutRoots,
  checkoutRootsClassifiedAsync,
  type GitProbeRunner,
  hasGitPathSegment,
  isBoundCheckout,
  type RealpathOutcome,
  realpathAsync,
} from "./platform/git.js";

/** Canonicalize an absolute path for comparison: resolve, then follow symlinks
 *  (best-effort — a non-existent path keeps its resolved form). Pins are stored
 *  realpath-canonicalized while session cwds / the raw query string may reach
 *  the same folder via a symlink (macOS /var→/private/var, a symlinked repo
 *  root), so BOTH sides of the guard must canonicalize identically or the match
 *  spuriously fails. See change: fix-kb-worktree-cwd-guard. */
export function canonPath(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

/** The MAIN CHECKOUT of `cwd` — the durable git repo root admission anchors on
 *  — or null when none resolves. Server-derived via git, never client-supplied.
 *
 *  Uses the shared checkout-root resolution rather than the superseded
 *  `dirname(--git-common-dir)`, which names a real checkout only when the git
 *  dir happens to sit inside one. Under `--separate-git-dir` that parent is a
 *  real but UNRELATED directory which could itself be a known folder — an
 *  over-admission this anchor closes.
 *
 *  The `.git`-segment rejection and the repository binding are this
 *  consumer's OWN obligations: the resolver returns a user-controlled
 *  `core.worktree` value verbatim and does not judge it. Being an
 *  AUTHORIZATION consumer, the safe response is to derive no main path at all,
 *  so the value is never matched against the known-folder set. Binding
 *  re-resolves the candidate and requires it to point back at the SAME common
 *  dir, which closes a repository-local `core.worktree` naming an unrelated
 *  KNOWN folder.
 *
 *  A submodule resolves to its own checkout and therefore does NOT inherit
 *  trust from its superproject; a worktree of a bare hub resolves to null and
 *  is rejected unless independently known.
 *  The probes run through the SYNCHRONOUS runner on a Fastify request path, so
 *  the per-probe budget is what bounds event-loop blocking. The superseded
 *  implementation blocked for at most one 2000ms `execFileSync`; resolving the
 *  cwd takes up to FIVE probes and binding a linked-worktree candidate takes up
 *  to FIVE MORE, so the budget is 200ms each to hold the SAME 2s worst case
 *  (10 × 200ms) rather than multiplying it. A healthy git answers in ~10ms; only
 *  a pathological (network-mounted, unresponsive) checkout approaches the bound,
 *  and a timeout degrades to "no result" → reject, never admit.
 *  See changes: add-git-checkout-root-resolver (was: fix-kb-worktree-cwd-guard),
 *  widen-containment-to-resolved-checkout. */
export function mainCheckoutPath(cwd: string): string | null {
  const roots = checkoutRoots({ cwd, timeout: 200 });
  const main = roots?.mainCheckout;
  if (!main) return null;
  return isBoundCheckout(main, roots.commonDir, { timeout: 200 }) ? main : null;
}

/** Pure cwd guard: a cwd is allowed when it (or its resolved MAIN CHECKOUT) is
 *  a known folder. Both sides canonicalize.
 *  See change: fix-plugin-action-fanout-and-handlers. */
export function isAllowedCwd(cwd: string | undefined, known: () => string[]): cwd is string {
  if (!cwd) return false;
  const target = canonPath(cwd);
  // A git-internal path is never a legitimate project root, so it is rejected
  // BEFORE either admission path — including the direct known-folder match,
  // which a stray pinned or session cwd of `<repo>/.git` would otherwise satisfy.
  //
  // The CANONICAL form is the only one worth testing. `hasGitPathSegment`
  // normalizes before splitting, so a raw `<repo>/.git/..` collapses to
  // `<repo>` on both sides — and `<repo>` is not a traversal, it IS the known
  // folder. `canonPath` additionally realpaths, so a symlink AIMED at a git dir
  // is caught here and would be missed by a raw-string test.
  if (hasGitPathSegment(target)) return false;
  const knownCanon = known().map(canonPath);
  if (knownCanon.includes(target)) return true;
  // Admit a cwd whose MAIN CHECKOUT is a known folder (covers a session-less
  // worktree — worktrees are never pinned and their session is transient, so
  // the durable repo root is the trust anchor).
  const main = mainCheckoutPath(cwd);
  if (main && knownCanon.includes(canonPath(main))) return true;
  return false;
}

// ── Async tri-state admission (harden-plugin-cwd-admission) ──────────────────
//
// `isAllowedCwd` above answers a boolean and runs up to ten SYNCHRONOUS git
// probes, so on a request path a probe timeout became a false 403 and a burst
// of distinct worktrees serialized on the event loop. `admitCwd` is the async,
// bounded, tri-state sibling for plugin ROUTES: it never admits on a failure to
// decide, never blocks the loop, and caches nothing across requests.
// `isAllowedCwd` stays for non-route callers.

/** One-shot, request-scoped proof that a cwd was admitted. Never serialized. */
export interface AdmissionToken {
  readonly canonCwd: string;
  readonly rawCwd: string;
}

/** Outcome of {@link admitCwd}. `indeterminate` is NOT a refusal and NEVER admits. */
export type Admission =
  | { kind: "admit"; token: AdmissionToken }
  | { kind: "refuse" }
  | { kind: "indeterminate"; failedProbes: string[]; elapsedMs: number };

/** Info handed to `onIndeterminate` so the host can log without a logger dependency here. */
export interface IndeterminateInfo {
  cwd: string;
  failedProbes: string[];
  elapsedMs: number;
}

export interface AdmitCwdOptions {
  /** Called once per `indeterminate` decision (the host throttles + logs). */
  onIndeterminate?: (info: IndeterminateInfo) => void;
  /** Per-probe git budget. Default {@link ADMISSION_PROBE_TIMEOUT_MS}. */
  probeTimeoutMs?: number;
  /** Whole-decision deadline from entry. Default {@link ADMISSION_DEADLINE_MS}. */
  deadlineMs?: number;
  /** Test seam: injected git runner (see `GitProbeRunner`). */
  runner?: GitProbeRunner;
  /** Test seam: injected errno-reporting realpath. */
  realpath?: (p: string) => Promise<RealpathOutcome>;
}

/** Global cap on concurrent git derivations. */
export const ADMISSION_MAX_CONCURRENT = 4;
/** Per-probe git timeout. */
export const ADMISSION_PROBE_TIMEOUT_MS = 1000;
/** Overall decision deadline, counted from entry (includes the semaphore wait). */
export const ADMISSION_DEADLINE_MS = 3000;

/** Module-private liveness registry: only this module can mint or check a token. */
const tokens = new WeakMap<AdmissionToken, { live: boolean }>();

function mintToken(canonCwd: string, rawCwd: string): AdmissionToken {
  const token: AdmissionToken = Object.freeze({ canonCwd, rawCwd });
  tokens.set(token, { live: true });
  return token;
}

/** End a token's life. Call in the route handler's `finally`. Idempotent. */
export function releaseAdmission(token: AdmissionToken): void {
  const state = tokens.get(token);
  if (state) state.live = false;
}

/** Whether `token` was minted by this module and its request has not finished. */
export function isAdmissionLive(token: AdmissionToken | undefined): token is AdmissionToken {
  return token !== undefined && tokens.get(token)?.live === true;
}

/** Whether a live `token` is bound to exactly this `cwd` string. */
export function tokenAllows(token: AdmissionToken | undefined, cwd: string | undefined): cwd is string {
  return cwd !== undefined && isAdmissionLive(token) && token.rawCwd === cwd;
}

/**
 * Sync predicate a route branches on after `await admitCwd(...)`. A plain
 * boolean guard so static analysis keeps a modelled path-injection barrier
 * (`.github/codeql/extensions/cwd-guard.model.yml`).
 */
export function admissionAllows(admission: Admission, cwd: string | undefined): cwd is string {
  return admission.kind === "admit" && tokenAllows(admission.token, cwd);
}

/**
 * Mint a token from the host's post-verdict decision (`holdCwdDenial`). The host
 * returns a DECISION, never a token, so each plugin mints from its own module
 * instance; the canonical cwd must equal the decision's, so a decision for one
 * path cannot be replayed for another.
 */
export async function issueHeldAdmission(
  decision: { kind: string; canonCwd?: string },
  rawCwd: string,
): Promise<{ kind: "admit"; token: AdmissionToken } | { kind: "refuse" }> {
  if (decision.kind !== "admit" || !decision.canonCwd) return { kind: "refuse" };
  const canon = await canonPathAsync(rawCwd);
  if (canon !== decision.canonCwd || hasGitPathSegment(canon)) return { kind: "refuse" };
  return { kind: "admit", token: mintToken(canon, rawCwd) };
}

/** Async twin of {@link canonPath}: resolve, then follow symlinks when possible. */
export async function canonPathAsync(p: string): Promise<string> {
  const abs = resolve(p);
  const r = await realpathAsync(abs);
  return r.kind === "ok" ? r.path : abs;
}

// ── Semaphore ───────────────────────────────────────────────────────────────

let activeDerivations = 0;
const slotWaiters: Array<() => void> = [];

function acquireSlot(): { granted: Promise<void>; cancel: () => boolean } {
  if (activeDerivations < ADMISSION_MAX_CONCURRENT) {
    activeDerivations++;
    return { granted: Promise.resolve(), cancel: () => false };
  }
  let wake!: () => void;
  const granted = new Promise<void>((res) => {
    wake = res;
  });
  slotWaiters.push(wake);
  return {
    granted,
    cancel: () => {
      const i = slotWaiters.indexOf(wake);
      if (i < 0) return false; // already granted
      slotWaiters.splice(i, 1);
      return true;
    },
  };
}

function releaseSlot(): void {
  const next = slotWaiters.shift();
  if (next) next(); // hand the slot straight over; the count is unchanged
  else activeDerivations--;
}

// ── Derivation (shared by concurrent callers of one canonical cwd) ──────────

type Derived =
  | { kind: "admit" }
  | { kind: "refuse" }
  | { kind: "indeterminate"; failedProbes: string[] };

const inflight = new Map<string, Promise<Derived>>();

function derive(
  canon: string,
  known: () => string[],
  opts: AdmitCwdOptions,
  enteredAt: number,
): Promise<Derived> {
  const existing = inflight.get(canon);
  if (existing) return existing;

  const promise = new Promise<Derived>((resolveOuter) => {
    const abort = new AbortController();
    let liveProbes = 0;
    let finished = false;
    let slotHeld = false;
    let slotReleased = false;
    let settledOuter = false;

    const settle = (d: Derived) => {
      if (settledOuter) return;
      settledOuter = true;
      clearTimeout(deadlineTimer);
      inflight.delete(canon);
      resolveOuter(d);
    };
    // The slot is freed only once the derivation is over AND its last git child
    // has exited, so the cap bounds live PROCESSES, not merely promises started.
    const maybeRelease = () => {
      if (slotHeld && finished && liveProbes === 0 && !slotReleased) {
        slotReleased = true;
        releaseSlot();
      }
    };

    const deadlineMs = opts.deadlineMs ?? ADMISSION_DEADLINE_MS;
    const slot = acquireSlot();
    const deadlineTimer = setTimeout(
      () => {
        const wasQueued = slot.cancel();
        abort.abort();
        settle({ kind: "indeterminate", failedProbes: ["deadline"] });
        if (wasQueued) return; // never held a slot
        finished = true; // late probe results are ignored from here on
        maybeRelease();
      },
      Math.max(0, deadlineMs - (Date.now() - enteredAt)),
    );

    const gitOpts: ClassifiedGitOptions = {
      timeout: opts.probeTimeoutMs ?? ADMISSION_PROBE_TIMEOUT_MS,
      signal: abort.signal,
      runner: opts.runner,
      onProbeStart: () => {
        liveProbes++;
      },
      onProbeEnd: () => {
        liveProbes--;
        maybeRelease();
      },
    };

    void (async () => {
      await slot.granted;
      if (settledOuter) {
        // Deadline fired while queued: the timer already cancelled the waiter,
        // so a grant here would be a bug — but never leak a slot if it happens.
        slotHeld = true;
        finished = true;
        maybeRelease();
        return;
      }
      slotHeld = true;
      try {
        settle(await deriveOnce(canon, known, gitOpts));
      } catch {
        settle({ kind: "indeterminate", failedProbes: ["derivation"] });
      } finally {
        finished = true;
        maybeRelease();
      }
    })();
  });
  inflight.set(canon, promise);
  return promise;
}

async function deriveOnce(canon: string, known: () => string[], gitOpts: ClassifiedGitOptions): Promise<Derived> {
  const rootsResult = await checkoutRootsClassifiedAsync({ cwd: canon }, gitOpts);
  if (rootsResult.kind === "failed") return { kind: "indeterminate", failedProbes: rootsResult.failedProbes };
  if (rootsResult.kind === "none") return { kind: "refuse" };
  const { mainCheckout, commonDir } = rootsResult.roots;
  if (!mainCheckout) return { kind: "refuse" };
  const bound = await bindCheckoutClassifiedAsync(mainCheckout, commonDir, gitOpts);
  if (bound.kind === "failed") return { kind: "indeterminate", failedProbes: bound.failedProbes };
  if (bound.kind === "unbound") return { kind: "refuse" };
  const mainCanon = await canonPathAsync(mainCheckout);
  const knownCanon = await canonKnown(known);
  return knownCanon.includes(mainCanon) ? { kind: "admit" } : { kind: "refuse" };
}

async function canonKnown(known: () => string[]): Promise<string[]> {
  return Promise.all(known().map(canonPathAsync));
}

/**
 * Decide admission for a plugin route's `cwd`, asynchronously and bounded.
 *
 * Order (design D2): realpath → missing & unknown ⇒ refuse (no git) → `.git`
 * segment ⇒ refuse → canonical cwd known ⇒ admit → classified checkout-root
 * derivation (global cap, deadline, in-flight dedupe, no cross-request cache).
 * A failure to decide is `indeterminate`, which routes answer with 503, never 403.
 *
 * Callers keep their own `400` for an absent cwd BEFORE calling this.
 */
export async function admitCwd(cwd: string, known: () => string[], opts: AdmitCwdOptions = {}): Promise<Admission> {
  const enteredAt = Date.now();
  const indeterminate = (failedProbes: string[]): Admission => {
    const info = { cwd, failedProbes, elapsedMs: Date.now() - enteredAt };
    try {
      opts.onIndeterminate?.(info);
    } catch {
      /* logging must never change the verdict */
    }
    return { kind: "indeterminate", failedProbes, elapsedMs: info.elapsedMs };
  };

  const abs = resolve(cwd);
  const real = await (opts.realpath ?? realpathAsync)(abs);
  if (real.kind === "error") return indeterminate(["realpath"]);
  const canon = real.kind === "ok" ? real.path : abs;
  if (hasGitPathSegment(canon)) return { kind: "refuse" };

  const knownCanon = await canonKnown(known);
  if (knownCanon.includes(canon)) return { kind: "admit", token: mintToken(canon, cwd) };
  // A deleted worktree (and anything else that does not exist) is refused
  // without spawning git, which would only surface as a spawn failure.
  if (real.kind === "missing") return { kind: "refuse" };

  const derived = await derive(canon, known, opts, enteredAt);
  if (derived.kind === "indeterminate") return indeterminate(derived.failedProbes);
  if (derived.kind === "refuse") return { kind: "refuse" };
  return { kind: "admit", token: mintToken(canon, cwd) };
}
