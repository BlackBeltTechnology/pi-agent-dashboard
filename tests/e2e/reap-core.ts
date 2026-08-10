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

  return {
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
