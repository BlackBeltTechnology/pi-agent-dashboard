/**
 * Pure decision logic behind the browser-E2E session-reap fixture.
 *
 * Deliberately dependency-free (no Playwright, no BusClient, no I/O): every
 * branch here is unit-tested at L1 from `scripts/__tests__/e2e-reap-core.test.mjs`
 * with an injected clock. `fixtures.ts` supplies the real bus/HTTP effects.
 *
 * Background: the harness is ONE 4 GiB container shared by all 90 specs, and
 * specs spawn from 138 call sites while exactly one ever ends a session. The
 * container therefore crosses its memory ceiling mid-run, thrashes, and the
 * daemon dies — surfacing as a wall of phantom spec failures (#433).
 *
 * See change: fix-e2e-harness-memory-exhaustion (design D3, D4, D5).
 */

/** Minimal shape this module needs from a `DashboardSession`. */
export interface SessionLike {
  id: string;
  cwd?: string;
  /** Absent means live; the server only sets this to `false` on close. */
  live?: boolean;
  status?: string;
}

/**
 * Is this session record backed by a process that is still running?
 *
 * `BusClient.read.sessions()` is a local map fed by `sessions_snapshot` +
 * deltas, and it only DROPS an entry on `session_removed`. A session that has
 * been shut down keeps its record (with `live:false` / `status:"ended"`) until
 * the server removes it, which can lag well behind the process exiting.
 *
 * Counting those records as live made the residual budget fire on almost every
 * test (96 false breaches in one acceptance run) while only 2 `pi` processes
 * were actually resident, and made the reap send `shutdown` to already-dead
 * sessions and then block for the ack timeout. Both call sites filter through
 * here instead.
 */
export function isLiveSession(s: SessionLike): boolean {
  return s.live !== false && s.status !== "ended";
}

/**
 * D5 — starting budget for *residual* live sessions after a reap.
 *
 * Derivation: measured per-session RSS is 150–280 MB (avg ~125 MB in the
 * mid-run sample) against a 4 GiB cap less ~630 MB of dashboard server, giving
 * a ceiling of roughly 27 concurrent sessions at the average and as few as 12
 * at the 280 MB worst case. 8 is a tripwire with headroom under BOTH ends, so
 * it fires before the cap rather than after it.
 *
 * This bounds the RESIDUAL set left behind after reaping — it is NOT the peak
 * concurrent capacity. Conflating the two would overstate the guarantee: the
 * memory bound itself is verified by the acceptance run's `memory.current`,
 * not by this count. The budget's job is to catch what the delta misses
 * (in-flight registration, `beforeAll` spawns, agent-spawned children) at the
 * spec that caused it.
 */
export const RESIDUAL_SESSION_BUDGET = 8;

/**
 * D4 — consecutive `/api/health` failures required before declaring the
 * harness dead.
 *
 * Why 3 and not 1: the measured pre-death state is a container thrashing at its
 * memory ceiling, where `/api/health` times out while the daemon is still alive
 * and would recover once reaping relieves pressure. A single-probe latch turns
 * that performance symptom into a false global verdict and skips the rest of
 * the run.
 */
export const LATCH_FAILURE_THRESHOLD = 3;

/** Prefix that makes a harness death unmistakable in the reporter output. */
export const HARNESS_DOWN_MESSAGE = "HARNESS DOWN";

/**
 * D3 — the ids that appeared during the test body, and only those.
 *
 * Pre-existing sessions (notably the `PI_E2E_INDEPENDENT_SESSION` pi that
 * `faux-ask.spec.ts` proves reconnect against) are never in a delta, so no
 * allowlist and no opt-out is needed. Duplicates are collapsed so a repeated id
 * cannot produce a repeated shutdown.
 */
export function computeDelta(pre: readonly string[], post: readonly string[]): string[] {
  const before = new Set(pre);
  const seen = new Set<string>();
  const delta: string[] = [];
  for (const id of post) {
    if (before.has(id) || seen.has(id)) continue;
    seen.add(id);
    delta.push(id);
  }
  return delta;
}

export interface SettleOptions {
  /** Return early once the list has been unchanged for this long. */
  stableMs?: number;
  /** Hard ceiling on total settle time. */
  capMs?: number;
  /** Gap between reads. */
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * D3 — re-read the session list until it stops moving, then hand it to
 * `computeDelta`.
 *
 * Without this, a session whose spawn was issued before the post-body read but
 * which registers after it is absent from the delta and becomes "pre-existing"
 * for every later test: a permanent leak that no later mechanism attributes to
 * the spec that caused it. Bounded by `capMs` so a container that never settles
 * costs a fixed 5 s rather than hanging the teardown.
 */
export async function settleSessionIds(
  read: () => readonly string[] | Promise<readonly string[]>,
  opts: SettleOptions = {},
): Promise<string[]> {
  const stableMs = opts.stableMs ?? 1_000;
  const capMs = opts.capMs ?? 5_000;
  const pollMs = opts.pollMs ?? 250;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const start = now();
  let last = [...(await read())];
  let lastChangedAt = now();

  while (now() - start < capMs) {
    await sleep(pollMs);
    const current = [...(await read())];
    if (!sameIds(last, current)) {
      last = current;
      lastChangedAt = now();
      continue;
    }
    if (now() - lastChangedAt >= stableMs) return last;
  }
  return last;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export interface LatchVerdict {
  armed: boolean;
  consecutiveFailures: number;
  message: string;
}

export interface Latch {
  readonly armed: boolean;
  readonly consecutiveFailures: number;
  /** Feed one probe result. Returns the verdict after recording it. */
  record(probeOk: boolean): LatchVerdict;
  /**
   * A harness-POLICY refusal was observed (D2). Sticky (decision E4): never
   * re-probed, never cleared — a refusal does not recover on a Playwright retry.
   */
  readonly refused: boolean;
  refuse(message: string): void;
  /**
   * Whether the current test should be skipped outright.
   *
   * The caller probes FIRST and passes the fresh result in, so a CI retry
   * (`retries: 1`) of a harness-down test re-probes and fails again rather than
   * reporting as a misleading skip.
   */
  shouldSkip(state: { probeOk: boolean }): boolean;
}

/**
 * D4 — the harness-death latch.
 *
 * NOTE: the fixture holds ONE of these as module state shared across spec files
 * by the single Playwright worker. That silently depends on `workers: 1` +
 * `fullyParallel: false` in `playwright.config.ts`; a future worker bump would
 * give each worker its own latch and partially resurrect the phantom-failure
 * cascade. Recorded here so that change surfaces this.
 */
export function createLatch(threshold: number = LATCH_FAILURE_THRESHOLD): Latch {
  let consecutiveFailures = 0;
  let armed = false;
  let refused = false;

  return {
    get refused() {
      return refused;
    },
    refuse(_message: string) {
      refused = true;
    },
    get armed() {
      return armed;
    },
    get consecutiveFailures() {
      return consecutiveFailures;
    },
    record(probeOk: boolean): LatchVerdict {
      if (probeOk) {
        // A dead container never recovers within a run, so an armed latch is
        // never disarmed — only the pre-arm failure run resets.
        if (!armed) consecutiveFailures = 0;
      } else {
        consecutiveFailures += 1;
        if (consecutiveFailures >= threshold) armed = true;
      }
      return {
        armed,
        consecutiveFailures,
        message: armed
          ? `${HARNESS_DOWN_MESSAGE}: the Docker E2E harness failed ${consecutiveFailures} ` +
            `consecutive /api/health probes and is being treated as dead. Remaining tests are ` +
            `skipped — they carry no information about the product. Check the harness container ` +
            `(docker/test-up.sh) and its memory cgroup before reading these results as regressions.`
          : "",
      };
    },
    shouldSkip(state: { probeOk: boolean }): boolean {
      return armed && !state.probeOk;
    },
  };
}

export type GateAction = "run" | "skip" | "fail";

export interface GateDecision {
  action: GateAction;
  message: string;
}

/**
 * D4 — how the fixture must act on one probe result.
 *
 * NOTE: this RECORDS the probe into the latch as well as deciding — one call
 * per test, and the decision depends on the arm transition, so splitting record
 * from decide would let a caller consult a stale state and reintroduce exactly
 * the ordering bug below. Deterministic and I/O-free, so the ordering is pinned
 * by L1 tests instead of living untested inside the Playwright fixture.
 *
 * The ordering is the whole point, and it is easy to get backwards (it was):
 *
 *   - The probe that ARMS the latch must **fail** — that is the one loud
 *     announcement of the harness's death. Consulting "should I skip?" first
 *     silently swallows it, and the run then looks like a wall of skips with no
 *     stated cause.
 *   - A later probe that also fails must **skip** — the death is already
 *     reported; re-announcing it per test recreates the noise this exists to
 *     remove.
 *   - An armed latch whose FRESH probe succeeds must **run**. A CI retry
 *     re-probes, and if the harness answers, the test carries real information.
 *     Failing it with HARNESS DOWN would be a lie about a harness that just
 *     responded.
 */
export function decideGate(latch: Latch, probeOk: boolean): GateDecision {
  // A refusal latch is sticky (E4): a retry of the test that observed it is
  // skipped too, without consulting the probe.
  if (latch.refused) return { action: "skip", message: HARNESS_UNUSABLE_MESSAGE };
  const wasArmed = latch.armed;
  const verdict = latch.record(probeOk);

  if (!wasArmed && verdict.armed) return { action: "fail", message: verdict.message };
  if (latch.shouldSkip({ probeOk })) {
    return {
      action: "skip",
      message: `${HARNESS_DOWN_MESSAGE} — skipping (see the first failure above).`,
    };
  }
  return { action: "run", message: "" };
}

export interface BudgetResult {
  ok: boolean;
  count: number;
  budget: number;
  message: string;
}

/**
 * D5 — assert the post-reap residual stays under budget, attributing a breach
 * to the spec that caused it rather than to the collapse 40 specs later.
 */
export function checkBudget(
  live: readonly SessionLike[],
  budget: number = RESIDUAL_SESSION_BUDGET,
): BudgetResult {
  const count = live.length;
  if (count <= budget) {
    return { ok: true, count, budget, message: "" };
  }
  const listed = live.map((s) => `  - ${s.id} (cwd: ${s.cwd ?? "<unknown>"})`).join("\n");
  return {
    ok: false,
    count,
    budget,
    message:
      `Residual live-session budget exceeded: ${count} sessions remain after reaping, ` +
      `budget is ${budget}. A session outliving its spec is the leak this budget exists ` +
      `to catch — see openspec change fix-e2e-harness-memory-exhaustion (D5).\n` +
      `Live sessions:\n${listed}`,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Refusal-aware latch + harness-global trust isolation (pure decision logic).
// See change: triage-browser-e2e-offbox-poison (design D2, D3).
// ───────────────────────────────────────────────────────────────────────────

/**
 * D2 — the harness-POLICY refusal literals. A 403 whose `error` is one of these
 * says the harness itself refuses the suite's credential-free client (network
 * guard / host gate). The ONE place the list lives; anything else is "unknown".
 */
export const HARNESS_POLICY_REFUSAL_ERRORS: readonly string[] = ["network_not_allowed", "host_not_allowed"];

/** Prefix that makes an unexpected harness refusal unmistakable in reporter output. */
const HARNESS_REFUSED_MESSAGE = "HARNESS REFUSED";

/** Skip message for every test after a refusal latched (sticky, decision E4). */
export const HARNESS_UNUSABLE_MESSAGE = `${HARNESS_REFUSED_MESSAGE} — harness unusable, skipping (see the first failure above).`;

type RefusalAction = "latch" | "fail-no-latch" | "warn-continue";

export interface RefusalInput {
  /** `OffBoxError.status` — undefined means transport (never reached the endpoint). */
  status?: number;
  /** `OffBoxError.error` — the guard's machine-readable literal. */
  error?: string;
  /** `OffBoxError.message` — rendered into the verdict for humans, NEVER classified on. */
  message?: string;
  /** Boot baseline admits the credential-free client (globalSetup, D2 arm condition 1). */
  credentialFreeAdmitted: boolean;
  /** A `narrowTrust` record is active (D2 arm condition 2). */
  narrowingActive: boolean;
}

export interface RefusalDecision {
  action: RefusalAction;
  message: string;
}

/**
 * D2 — classify one pre-snapshot refusal. Reads typed fields only: a message
 * that merely CONTAINS a policy literal is not a policy refusal.
 *
 * Armed only when the boot baseline admitted the credential-free client AND no
 * declared narrowing is active; otherwise the refusal is expected and keeps
 * today's warn-and-continue. A transport error never latches (the 3-strike
 * liveness counter governs it).
 */
export function decideRefusal(input: RefusalInput): RefusalDecision {
  const armed = input.credentialFreeAdmitted && !input.narrowingActive;
  if (!armed || input.status === undefined) return { action: "warn-continue", message: "" };

  const detail = [
    `HTTP ${input.status}`,
    input.error ? input.error : undefined,
    input.message ? `(${input.message})` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  const policy =
    input.status === 403 && input.error !== undefined && HARNESS_POLICY_REFUSAL_ERRORS.includes(input.error);
  if (policy) {
    return {
      action: "latch",
      message:
        `${HARNESS_REFUSED_MESSAGE}: the E2E harness refuses the suite's own client by policy — ${detail}. ` +
        `The harness is unusable; remaining tests are skipped. Find which spec narrowed trust ` +
        `(tripwire output above) or what changed the server's trust posture.`,
    };
  }
  return {
    action: "fail-no-latch",
    message: `${HARNESS_REFUSED_MESSAGE}: the E2E harness refused the suite's own client — ${detail}. This test fails; the run continues.`,
  };
}

/** Error-like view used by the catch-path wiring (an `OffBoxError` or anything else). */
function errorFields(err: unknown): { status?: number; error?: string; message?: string } {
  if (!err || typeof err !== "object") return { message: String(err) };
  const e = err as { status?: unknown; error?: unknown; message?: unknown };
  return {
    status: typeof e.status === "number" ? e.status : undefined,
    error: typeof e.error === "string" ? e.error : undefined,
    message: typeof e.message === "string" ? e.message : undefined,
  };
}

/** Pure wiring for the reap pre-snapshot `catch` (fixtures.ts) — X7. */
export function decidePreSnapshotError(
  err: unknown,
  ctx: { credentialFreeAdmitted: boolean; narrowingActive: boolean },
): RefusalDecision {
  return decideRefusal({ ...errorFields(err), ...ctx });
}

// ── Trust-bearing keys (D3) ────────────────────────────────────────────────

/** The `GET /api/config` keys that decide who the harness admits. */
export const TRUST_KEYS = [
  "trustedNetworks",
  "auth.bypassHosts",
  "auth.bypassUrls",
  "allowedHosts",
  "hostGate.mode",
  "requireLocalProof",
  "resolvedTrustedNetworks",
] as const;
export type TrustKey = (typeof TRUST_KEYS)[number];

/** List-valued keys: an absent one equals `[]` (decision E2). */
const LIST_KEYS: ReadonlySet<string> = new Set([
  "trustedNetworks",
  "auth.bypassHosts",
  "auth.bypassUrls",
  "allowedHosts",
  "resolvedTrustedNetworks",
]);

/** A config-shaped subset: only the trust-bearing keys of a `/api/config` body. */
export interface TrustSnapshot {
  trustedNetworks?: unknown;
  auth?: { bypassHosts?: unknown; bypassUrls?: unknown };
  allowedHosts?: unknown;
  hostGate?: { mode?: unknown };
  requireLocalProof?: unknown;
  resolvedTrustedNetworks?: unknown;
}

function readKey(cfg: TrustSnapshot | undefined, key: TrustKey): unknown {
  const c = cfg ?? {};
  switch (key) {
    case "auth.bypassHosts":
      return c.auth?.bypassHosts;
    case "auth.bypassUrls":
      return c.auth?.bypassUrls;
    case "hostGate.mode":
      return c.hostGate?.mode;
    default:
      return c[key];
  }
}

/** Defaults-filled value of one key (E2): an absent list is `[]`. */
function normalised(cfg: TrustSnapshot | undefined, key: TrustKey): unknown {
  const v = readKey(cfg, key);
  return LIST_KEYS.has(key) && v === undefined ? [] : v;
}

/** Pick the trust-bearing subset of a `/api/config` body (no defaults applied). */
export function pickTrust(data: unknown): TrustSnapshot {
  const d: TrustSnapshot = data && typeof data === "object" ? (data as TrustSnapshot) : {};
  const out: TrustSnapshot = {};
  for (const key of ["trustedNetworks", "allowedHosts", "requireLocalProof", "resolvedTrustedNetworks"] as const) {
    if (d[key] !== undefined) out[key] = structuredClone(d[key]);
  }
  if (d.auth && typeof d.auth === "object") {
    const auth: { bypassHosts?: unknown; bypassUrls?: unknown } = {};
    if (d.auth.bypassHosts !== undefined) auth.bypassHosts = structuredClone(d.auth.bypassHosts);
    if (d.auth.bypassUrls !== undefined) auth.bypassUrls = structuredClone(d.auth.bypassUrls);
    out.auth = auth;
  }
  if (d.hostGate && typeof d.hostGate === "object" && d.hostGate.mode !== undefined) {
    out.hostGate = { mode: d.hostGate.mode };
  }
  return out;
}

/** Scalar trust keys a response omitted — dropped from comparison with a note (X16). */
export function droppedTrustKeys(data: unknown): TrustKey[] {
  const snap = pickTrust(data);
  return TRUST_KEYS.filter((k) => !LIST_KEYS.has(k) && readKey(snap, k) === undefined);
}

interface TrustBreach {
  key: TrustKey;
  before: unknown;
  after: unknown;
}

export interface TrustComparison {
  ok: boolean;
  breaches: TrustBreach[];
  message: string;
}

/**
 * D3 / decision E2 — compare two trust snapshots: defaults filled first (absent
 * list ≡ `[]`), then exact and ORDER-sensitive. A scalar key either side omits
 * is not comparable and is skipped (never a false breach).
 */
export function compareTrust(before: TrustSnapshot | undefined, after: TrustSnapshot | undefined): TrustComparison {
  const breaches: TrustBreach[] = [];
  for (const key of TRUST_KEYS) {
    const b = normalised(before, key);
    const a = normalised(after, key);
    if (!LIST_KEYS.has(key) && (b === undefined || a === undefined)) continue;
    if (JSON.stringify(b) !== JSON.stringify(a)) breaches.push({ key, before: b, after: a });
  }
  return {
    ok: breaches.length === 0,
    breaches,
    message: breaches
      .map((x) => `${x.key}: ${JSON.stringify(x.before)} → ${JSON.stringify(x.after)}`)
      .join("; "),
  };
}

// ── Boot baseline + worker-start re-assert (D3 L2) ─────────────────────────

/** Shape of `test-results/.trust-baseline.json`. */
export interface TrustBaselineFile {
  /** `null` ⇒ no read path existed at boot; L2, the tripwire and the refusal verdict are all no-ops. */
  baseline: TrustSnapshot | null;
  /** An operator cookie exists (auth configured). */
  credential: boolean;
  /** One credential-free ticket mint against the freshly booted harness was admitted. */
  credentialFreeAdmitted: boolean;
}

/** globalSetup — build the file from what the harness answered. */
export function recordBaseline(input: {
  credential: boolean;
  credentialFreeAdmitted: boolean;
  /** `/api/config` `data` read by the best available path, or null when none could read it. */
  config: unknown | null;
}): TrustBaselineFile {
  return {
    baseline: input.config == null ? null : pickTrust(input.config),
    credential: input.credential,
    credentialFreeAdmitted: input.credentialFreeAdmitted,
  };
}

export type ReassertDecision = { action: "write"; baseline: TrustSnapshot } | { action: "noop" };

/** D3 L2 — write the harness's OWN boot baseline back, never the seed values. */
export function decideReassert(baseline: TrustSnapshot | null, live: TrustSnapshot | undefined): ReassertDecision {
  if (baseline === null) return { action: "noop" };
  return compareTrust(baseline, live).ok ? { action: "noop" } : { action: "write", baseline };
}

export type WorkerStartDecision =
  | { action: "noop" }
  | { action: "reassert"; baseline: TrustSnapshot }
  | { action: "latch"; message: string };

/**
 * D3 L2 — what the worker-scoped fixture does before its first test.
 * A refused config read means restore is impossible, so the run must not
 * continue pretending isolation holds.
 */
export function decideWorkerStart(
  file: TrustBaselineFile,
  read: { status: number; error?: string; data?: unknown },
): WorkerStartDecision {
  if (file.baseline === null) return { action: "noop" };
  if (read.status === 401 || read.status === 403) {
    return {
      action: "latch",
      message: `operator credential rejected: ${read.status} ${read.error ?? ""}`.trim(),
    };
  }
  if (read.status < 200 || read.status >= 300) return { action: "noop" };
  const d = decideReassert(file.baseline, pickTrust(read.data));
  return d.action === "write" ? { action: "reassert", baseline: d.baseline } : { action: "noop" };
}

export type PreReadDecision = { action: "none" } | { action: "reassert-and-fail"; baseline: TrustSnapshot; message: string };

/**
 * D3 — with no active narrowing the live keys must equal the boot baseline. A
 * difference is a leak from the last released owner (e.g. a failed describe
 * `afterAll`): re-assert and fail THAT test naming the owner.
 */
export function decidePreRead(input: {
  registryActive: boolean;
  baseline: TrustSnapshot | null;
  live: TrustSnapshot | undefined;
  lastReleasedOwner?: string;
}): PreReadDecision {
  if (input.registryActive || input.baseline === null) return { action: "none" };
  const cmp = compareTrust(input.baseline, input.live);
  if (cmp.ok) return { action: "none" };
  return {
    action: "reassert-and-fail",
    baseline: input.baseline,
    message:
      `Harness trust differs from its boot baseline with no declared narrowing active — ${cmp.message}. ` +
      `Last released narrowing owner: ${input.lastReleasedOwner ?? "<none>"}. Baseline re-asserted.`,
  };
}

/** globalSetup — admission mint with transport retry (decision E3). */
export async function recordCredentialFreeAdmission(opts: {
  mint: () => Promise<{ status: number }>;
  budgetMs: number;
  retryMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<boolean> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const start = now();
  let lastFailure = "no attempt";
  for (;;) {
    try {
      const { status } = await opts.mint();
      return status >= 200 && status < 300;
    } catch (err) {
      lastFailure = err instanceof Error ? err.message : String(err);
    }
    if (now() - start >= opts.budgetMs) break;
    await sleep(opts.retryMs ?? 500);
  }
  // Never `false` from a transport failure: that would silently disarm the
  // refusal verdict for the whole run.
  throw new Error(
    `globalSetup: credential-free ticket mint got no HTTP answer within ${opts.budgetMs}ms (${lastFailure}); ` +
      `refusing to record credentialFreeAdmitted from a transport failure.`,
  );
}

// ── narrowTrust registry ───────────────────────────────────────────────────

type NarrowScope = "test" | "describe";

export interface NarrowRecord {
  owner: string;
  scope: NarrowScope;
  snapshot: TrustSnapshot;
}

/** The trust keys a `narrowTrust` call writes (`patch`) or declares (`touches`) — what the restore must write back. */
export function narrowedKeys(patch: TrustSnapshot, touches: readonly TrustKey[] = []): TrustKey[] {
  const keys = new Set<TrustKey>(touches);
  for (const key of ["trustedNetworks", "allowedHosts", "requireLocalProof"] as const) {
    if (patch[key] !== undefined) keys.add(key);
  }
  if (patch.auth?.bypassHosts !== undefined) keys.add("auth.bypassHosts");
  if (patch.auth?.bypassUrls !== undefined) keys.add("auth.bypassUrls");
  if (patch.hostGate?.mode !== undefined) keys.add("hostGate.mode");
  // `resolvedTrustedNetworks` is derived: never written.
  keys.delete("resolvedTrustedNetworks");
  return TRUST_KEYS.filter((k) => keys.has(k));
}

/**
 * `PUT /api/config` body that puts `keys` back to `snapshot`. `liveAuth` is the
 * current (redacted) `auth` object: `PUT` replaces top-level keys wholesale, so
 * the bypass keys are merged onto it rather than dropping providers/secret.
 */
export function buildRestorePayload(
  keys: readonly TrustKey[],
  snapshot: TrustSnapshot,
  liveAuth: Record<string, unknown> = {},
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (keys.includes("trustedNetworks")) payload.trustedNetworks = normalised(snapshot, "trustedNetworks");
  if (keys.includes("allowedHosts")) payload.allowedHosts = normalised(snapshot, "allowedHosts");
  if (keys.includes("requireLocalProof") && snapshot.requireLocalProof !== undefined) {
    payload.requireLocalProof = snapshot.requireLocalProof;
  }
  if (keys.includes("hostGate.mode") && snapshot.hostGate?.mode !== undefined) {
    payload.hostGate = { mode: snapshot.hostGate.mode };
  }
  const bypass: Record<string, unknown> = {};
  if (keys.includes("auth.bypassHosts")) bypass.bypassHosts = normalised(snapshot, "auth.bypassHosts");
  if (keys.includes("auth.bypassUrls")) bypass.bypassUrls = normalised(snapshot, "auth.bypassUrls");
  if (Object.keys(bypass).length > 0) payload.auth = { ...liveAuth, ...bypass };
  return payload;
}
