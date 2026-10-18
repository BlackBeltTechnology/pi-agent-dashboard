/**
 * The browser-E2E `test` object. EVERY spec must import `test` (and `expect`)
 * from here rather than from `@playwright/test` — enforced by
 * `scripts/check-e2e-fixture-import.mjs`.
 *
 * What it adds, and why
 * ---------------------
 * The harness is ONE Docker container (4 GiB, `docker/compose.yml` `MEM_LIMIT`)
 * shared by all 90 specs. Specs spawn dashboard sessions from 138 call sites;
 * before this fixture, exactly one ever ended a session. Each session is a
 * separate OS process at 150–280 MB RSS, so the container crossed its ceiling
 * around 12–27 concurrent sessions, thrashed in reclaim, `/api/health` began
 * timing out, and the daemon died — after which every remaining spec failed in
 * ~400 ms against a dead port. That cascade is indistinguishable from mass
 * product regression, which is how issue #433 sat undiagnosed.
 *
 * Three behaviours, all automatic (`auto: true`, so there is no per-spec opt-in
 * and a new spec cannot silently skip them):
 *
 *   1. REAP (D1/D3) — snapshot session ids before the body, and after it shut
 *      down only the ids that appeared in between. Pre-existing sessions (the
 *      `PI_E2E_INDEPENDENT_SESSION` pi that `faux-ask.spec.ts` proves reconnect
 *      against) are never in a delta, so no allowlist is needed.
 *   2. LATCH (D4) — probe `/api/health` before each body; after
 *      `LATCH_FAILURE_THRESHOLD` consecutive failures declare the harness dead
 *      ONCE, by name, and skip the remainder instead of emitting phantom
 *      failures.
 *   3. BUDGET (D5) — assert the residual live-session count stays under budget,
 *      catching what the delta structurally cannot see (in-flight registration,
 *      `beforeAll` spawns, agent-spawned children).
 *
 * Reap is over the browser WS bus, NOT `POST /api/session/:id/shutdown`. The
 * REST route is a parallel implementation that omits the
 * `setLiveness({closedReason:"manual"})` write, so REST-closed sessions stay
 * cold-start recovery candidates and would be restored into `GET /api/sessions`
 * — polluting the very session list the delta and the budget read. Filed
 * separately; this routes around it.
 *
 * Client lifecycle is per-test, never worker-scoped: `BusClient` has no
 * reconnect, and `faux-ask.spec.ts` restarts the daemon mid-suite, which drops
 * every open socket. A worker-scoped client would be permanently dead from that
 * spec onward.
 *
 * SINGLE-WORKER DEPENDENCY: the latch is module state shared across spec files
 * by the one Playwright worker. That depends on `workers: 1` +
 * `fullyParallel: false` in `playwright.config.ts`. Raising `workers` gives each
 * worker its own latch and partially resurrects the cascade — change both
 * together.
 *
 * Refusal + trust isolation (change: triage-browser-e2e-offbox-poison):
 *
 *   4. REFUSAL LATCH (D2) — `/api/health` is a public exception to the network
 *      guard, so a harness that REFUSES the suite's own client still looks
 *      healthy. The reap pre-snapshot is the first credential-free bus call;
 *      a 403 `network_not_allowed` / `host_not_allowed` there (armed only when
 *      the boot baseline admitted the client and no `narrowTrust` is active)
 *      latches the harness unusable: sticky, persisted to disk (Playwright
 *      discards the worker after a failed test), the rest of the run skipped.
 *   5. TRUST ISOLATION (D3) — specs narrow harness-global trust ONLY through
 *      `narrowTrust`. Test-scope records are restored right after the body in
 *      this fixture (runs on failure and timeout, unlike `afterAll`); a
 *      worker-scoped fixture re-asserts the boot baseline for the case no
 *      teardown covers (worker killed); a tripwire attributes an undeclared
 *      leak to the spec that caused it.
 *
 * See change: fix-e2e-harness-memory-exhaustion.
 */

import path from "node:path";
import { BusClient } from "@blackbelt-technology/pi-dashboard-bus-client";
import type { SessionRemovedMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { type APIRequestContext, test as base, expect } from "@playwright/test";
import {
  readBaselineFile,
  readConfig,
  readRefusalLatch,
  writeConfig,
  writeRefusalLatch,
} from "./helpers/trust-access.js";
import { DASHBOARD_PORT, HEALTH_URL } from "./lifecycle.js";
import {
  buildRestorePayload,
  checkBudget,
  compareTrust,
  computeDelta,
  createLatch,
  decideGate,
  decidePreRead,
  decidePreSnapshotError,
  decideWorkerStart,
  HARNESS_DOWN_MESSAGE,
  isLiveSession,
  type NarrowRecord,
  narrowedKeys,
  pickTrust,
  RESIDUAL_SESSION_BUDGET,
  type SessionLike,
  settleSessionIds,
  TRUST_KEYS,
  type TrustKey,
  type TrustSnapshot,
} from "./reap-core.js";

export type { APIRequestContext, Locator, Page, WebSocket } from "@playwright/test";
export type { TrustKey, TrustSnapshot } from "./reap-core.js";
// Re-export `expect` plus EVERY type the specs pull from the same statement.
// A missing re-export here breaks every spec at once while the import guard still
// passes, so this list is type-checked by `npm run lint:e2e`, not eyeballed.
export { expect };

/** Module state — see the SINGLE-WORKER DEPENDENCY note above. */
const latch = createLatch();

const PROBE_TIMEOUT_MS = 10_000;
const SHUTDOWN_ACK_TIMEOUT_MS = 15_000;

/** D4 — explicit liveness probe. Not the bus socket state, which stays "open"
 *  through exactly the memory thrash this must detect. */
async function probeHarness(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Harness-global trust isolation (D3) ────────────────────────────────────

interface ActiveNarrowing extends NarrowRecord {
  /** Keys the restore must write back (patch keys ∪ declared `touches`). */
  keys: TrustKey[];
  /** Absolute path of the owning spec file — a describe record lives until the file's last test. */
  ownerFile: string;
  /** Describe scope only: credential-free session ids taken BEFORE narrowing, for the group reap. */
  sessionsBefore?: string[];
}

/** Active narrowings. Module state, same SINGLE-WORKER caveat as `latch`. */
const registry: ActiveNarrowing[] = [];
let lastReleasedOwner: string | undefined;
/** True only between the reap fixture's `use()` start and its drain: tells a test-scope call from a `beforeAll` one. */
let testBodyActive = false;
/** Set by the worker-start fixture; the worker's first test throws it once. */
let workerStartFailure: string | undefined;

const WRITABLE_TRUST_KEYS = TRUST_KEYS.filter((k) => k !== "resolvedTrustedNetworks");

/** Put the harness config back to `snapshot` for `keys`, with the operator cookie. */
async function writeTrustKeys(keys: readonly TrustKey[], snapshot: TrustSnapshot): Promise<void> {
  const cur = await readConfig(true);
  if (cur.status !== 200) throw new Error(`trust restore: config read refused (${cur.status} ${cur.error ?? ""})`.trim());
  const payload = buildRestorePayload(keys, snapshot, cur.data?.auth);
  if (Object.keys(payload).length === 0) return;
  const status = await writeConfig(payload);
  if (status < 200 || status >= 300) throw new Error(`trust restore: PUT /api/config answered ${status}`);
}

/**
 * Narrow harness-global trust for the calling test (or, from `beforeAll`, for
 * the spec file's tests) and register its restore. The ONLY sanctioned way for a
 * spec to change `trustedNetworks`, `auth.bypassHosts|bypassUrls`, `allowedHosts`,
 * `hostGate.mode` or `requireLocalProof` (the trust-write lint enforces it).
 *
 * - `patch` is written now; `{}` plus `touches` declares keys the test changes
 *   through the UI (Save), so the snapshot still restores them.
 * - Scope `test` (called from a test/`beforeEach`): restored by the reap fixture
 *   straight after the body, on failure and timeout too.
 * - Scope `describe` (called from `beforeAll`): restored when the next test of
 *   ANOTHER spec file starts — Playwright forbids registering `afterAll` from
 *   inside a running hook — and the group's sessions are reaped then.
 * - Needs the operator credential (auth configured): a narrowed harness refuses
 *   everything credential-free. Without it the call fails the test; such a spec
 *   belongs on a dedicated narrow-booted leg (`network-guard.spec.ts`).
 *
 * `request` is accepted so call sites read `narrowTrust(request, …)`; the
 * restore runs after Playwright disposes it, so everything here uses `fetch`.
 */
export async function narrowTrust(
  _request: APIRequestContext,
  patch: TrustSnapshot,
  opts: { touches?: TrustKey[] } = {},
): Promise<void> {
  const file = readBaselineFile();
  if (!file?.credential) {
    throw new Error(
      "harness has no operator credential — this spec must declare itself unrestorable and run on a dedicated leg " +
        "(a narrow-booted harness, see network-guard.spec.ts); runtime trust narrowing cannot be restored without it.",
    );
  }
  const info = base.info();
  const scope = testBodyActive ? "test" : "describe";
  const keys = narrowedKeys(patch, opts.touches);

  const cur = await readConfig(true);
  if (cur.status !== 200) {
    throw new Error(`narrowTrust: operator config read refused (${cur.status} ${cur.error ?? ""})`.trim());
  }
  const record: ActiveNarrowing = {
    owner: path.basename(info.file),
    scope,
    snapshot: pickTrust(cur.data),
    keys,
    ownerFile: info.file,
  };
  if (scope === "describe") {
    // Credential-free, BEFORE narrowing: the per-test pre-snapshot is skipped
    // while this record is active, so the group reap needs its own baseline.
    let client: BusClient | undefined;
    try {
      client = await connectBus();
      record.sessionsBefore = client.read.sessions().map((s) => s.id);
    } catch (err) {
      console.warn(`[reap] describe-scope pre-snapshot failed; this group's sessions will not be reaped: ${String(err)}`);
    } finally {
      client?.close();
    }
  }
  // Registered BEFORE the write: a failed or partial write must still be restored.
  registry.push(record);

  if (Object.keys(patch).length > 0) {
    const payload: Record<string, unknown> = { ...patch };
    delete payload.resolvedTrustedNetworks;
    if (patch.auth) payload.auth = { ...(cur.data?.auth ?? {}), ...patch.auth };
    const status = await writeConfig(payload);
    if (status < 200 || status >= 300) throw new Error(`narrowTrust: PUT /api/config answered ${status}`);
  }
}

/** Restore every record matching `pick`, newest first. Every record is attempted and removed. */
async function releaseNarrowings(pick: (r: ActiveNarrowing) => boolean): Promise<string[]> {
  const failures: string[] = [];
  for (let i = registry.length - 1; i >= 0; i--) {
    const rec = registry[i];
    if (!pick(rec)) continue;
    registry.splice(i, 1);
    lastReleasedOwner = rec.owner;
    try {
      await writeTrustKeys(rec.keys, rec.snapshot);
    } catch (err) {
      failures.push(`${rec.owner}: ${String(err)}`);
    }
    if (rec.scope === "describe" && rec.sessionsBefore) await reapGroupDelta(rec.sessionsBefore);
  }
  return failures;
}

/** Shut down the sessions a describe-scope group spawned (after the restore, so the bus client is admitted again). */
async function reapGroupDelta(before: readonly string[]): Promise<void> {
  let client: BusClient | undefined;
  try {
    client = await connectBus();
    const bus = client;
    const post = await settleSessionIds(() => bus.read.sessions().map((s) => s.id));
    const delta = computeDelta(before, post);
    await Promise.allSettled(delta.map((id) => shutdownSession(bus, id)));
  } catch (err) {
    console.warn(`[reap] describe-scope group reap failed (diagnostic only): ${String(err)}`);
  } finally {
    client?.close();
  }
}

/** Worker-scoped, before this worker's first test: heal a narrowing a killed predecessor left behind (D3 L2). */
async function reassertBaselineAtWorkerStart(): Promise<void> {
  const file = readBaselineFile();
  if (!file || file.baseline === null || readRefusalLatch()) return;
  let read: Awaited<ReturnType<typeof readConfig>>;
  try {
    read = await readConfig(file.credential);
  } catch {
    return; // transport trouble is the liveness probe's business
  }
  const decision = decideWorkerStart(file, read);
  if (decision.action === "latch") {
    workerStartFailure = decision.message;
    latch.refuse(decision.message);
    writeRefusalLatch(decision.message);
  } else if (decision.action === "reassert" && file.credential) {
    console.warn("[reap] worker start: live trust differs from the boot baseline — re-asserting the baseline");
    await writeTrustKeys(WRITABLE_TRUST_KEYS, decision.baseline).catch((err) =>
      console.warn(`[reap] baseline re-assert failed: ${String(err)}`),
    );
  }
}

export async function connectBus(): Promise<BusClient> {
  const client = new BusClient({ host: "localhost", port: DASHBOARD_PORT });
  await client.connect();
  return client;
}

/**
 * Shut down one session and await its `session_removed`.
 *
 * The ack is worth awaiting because it makes the session's RECORD gone before
 * the next test's pre-snapshot; fire-and-forget would let dying sessions appear
 * there and become permanent phantoms in every later delta.
 *
 * It does NOT mean the process exited. `handleShutdown` broadcasts
 * `session_removed` unconditionally, and its kill paths
 * (`headlessPidRegistry.killBySessionId`, `killHeadlessBySessionId`) are
 * headless-only — under the harness's `PI_SPAWN_STRATEGY=tmux` default nothing
 * terminates the process at all. Measured mid-run: 21 tmux panes = 21 resident
 * `pi` = 0 session records. Tracked in issue #452 / change
 * fix-tmux-session-shutdown-leak; do not reintroduce a claim of process death
 * here.
 *
 * An unknown/already-gone session is success — `notify-channel.spec.ts`
 * force-kills its own session mid-test, and that must not be an error here.
 */
export async function shutdownSession(client: BusClient, sessionId: string): Promise<void> {
  // `isLiveSession`, not mere presence: a shut-down session KEEPS its record
  // until `session_removed`. Treating a lingering `live:false`/`ended` record as
  // live meant sending `shutdown` to a dead session and then blocking the full
  // ack timeout waiting for a `session_removed` that had already been sent.
  const record = client.read.sessions().find((s) => s.id === sessionId);
  if (!record || !isLiveSession(record)) return; // already gone — success

  const removed = client
    .waitFor<SessionRemovedMessage>(
      (m) => m.type === "session_removed" && (m as SessionRemovedMessage).sessionId === sessionId,
      { timeout: SHUTDOWN_ACK_TIMEOUT_MS, label: `shutdown(${sessionId})` },
    )
    .catch(() => undefined); // a missed ack must not fail the spec

  client.send({ type: "shutdown", sessionId });
  await removed;
}

type BaselineFile = NonNullable<ReturnType<typeof readBaselineFile>>;

/** Credentialed (or, on a no-credential harness, credential-free) trust read before the test body. */
async function readPreTrust(file: BaselineFile | undefined): Promise<TrustSnapshot | undefined> {
  if (!file || file.baseline === null) return undefined;
  try {
    const read = await readConfig(file.credential);
    if (read.status === 200) return pickTrust(read.data);
    console.warn(`[reap] trust read refused (${read.status} ${read.error ?? ""}); tripwire off for this test`);
  } catch (err) {
    console.warn(`[reap] trust read failed; tripwire off for this test: ${String(err)}`);
  }
  return undefined;
}

/** With no declared narrowing the live keys must equal the boot baseline; a leak is healed and fails THIS test. */
async function failOnTrustLeak(file: BaselineFile | undefined, live: TrustSnapshot | undefined): Promise<void> {
  if (!file?.baseline || !live) return;
  const leak = decidePreRead({
    registryActive: registry.length > 0,
    baseline: file.baseline,
    live,
    lastReleasedOwner,
  });
  if (leak.action !== "reassert-and-fail") return;
  if (file.credential) {
    await writeTrustKeys(WRITABLE_TRUST_KEYS, leak.baseline).catch((err) =>
      console.warn(`[reap] baseline re-assert failed: ${String(err)}`),
    );
  }
  throw new Error(leak.message);
}

/**
 * The reap pre-snapshot. `preOk` is load-bearing. Without it a failed snapshot
 * leaves `pre` empty, and an empty pre-snapshot makes computeDelta classify
 * EVERY session as spawned-during-test — including the
 * PI_E2E_INDEPENDENT_SESSION pi that faux-ask.spec.ts proves reconnect against.
 * A transient bus hiccup would then destroy the harness's own session. Reaping
 * nothing leaks at worst; reaping everything breaks the suite.
 *
 * A harness-POLICY refusal is a verdict, not bookkeeping noise (D2): it throws.
 */
async function takePreSnapshot(file: BaselineFile | undefined): Promise<{ pre: string[]; preOk: boolean }> {
  if (registry.length > 0) {
    // The bus client sends no credentials, so a narrowed harness refuses it by
    // design. The group's sessions are reaped when the narrowing releases.
    console.warn(`[reap] pre-snapshot skipped: declared narrowing active (${registry[registry.length - 1].owner})`);
    return { pre: [], preOk: false };
  }
  let client: BusClient | undefined;
  try {
    client = await connectBus();
    return { pre: client.read.sessions().map((s) => s.id), preOk: true };
  } catch (err) {
    const refusal = decidePreSnapshotError(err, {
      credentialFreeAdmitted: file?.credentialFreeAdmitted ?? false,
      narrowingActive: false,
    });
    if (refusal.action === "latch") {
      latch.refuse(refusal.message);
      writeRefusalLatch(refusal.message);
      throw new Error(refusal.message);
    }
    if (refusal.action === "fail-no-latch") throw new Error(refusal.message);
    // Never fail a spec on reap bookkeeping — report and continue unreaped.
    console.warn(`[reap] pre-snapshot failed; skipping this test's reap: ${String(err)}`);
    return { pre: [], preOk: false };
  } finally {
    client?.close();
  }
}

/** After the body: restore test-scope narrowings, then tripwire the owning test. Returns failure messages. */
async function restoreAndTripwire(
  file: BaselineFile | undefined,
  preTrust: TrustSnapshot | undefined,
  specFile: string,
): Promise<string[]> {
  const failures: string[] = [];
  const restoreFailures = await releaseNarrowings((r) => r.scope === "test");
  if (restoreFailures.length > 0) failures.push(`trust restore failed — ${restoreFailures.join("; ")}`);
  if (!preTrust || !file || latch.refused) return failures;
  try {
    const post = await readConfig(file.credential);
    if (post.status !== 200) return failures;
    const cmp = compareTrust(preTrust, pickTrust(post.data));
    if (cmp.ok) return failures;
    failures.push(
      `${path.basename(specFile)} left harness trust changed — ${cmp.message}. ` +
        `Narrow trust only through narrowTrust(...) (declare UI-driven keys with { touches }).`,
    );
    // Heal so the NEXT test is not the one to fail for this leak.
    if (file.credential) {
      await writeTrustKeys(WRITABLE_TRUST_KEYS, preTrust).catch((err) =>
        console.warn(`[reap] tripwire heal failed: ${String(err)}`),
      );
    }
  } catch (err) {
    console.warn(`[reap] tripwire read failed (diagnostic only): ${String(err)}`);
  }
  return failures;
}

/**
 * Settle, reap the delta, check the budget. Every error is swallowed and
 * reported as a DIAGNOSTIC. When the daemon dies mid-test the reap's
 * connect()/send() throws `bus client not connected`; surfacing that would
 * replace the spec's real assertion failure under exactly the condition the
 * latch exists for.
 */
async function reapAfterBody(pre: string[], testInfo: { annotations: { type: string; description?: string }[] }): Promise<void> {
  let client: BusClient | undefined;
  try {
    client = await connectBus();
    const bus = client;

    const post = await settleSessionIds(() => bus.read.sessions().map((s) => s.id));
    const delta = computeDelta(pre, post);

    if (delta.length > 0) {
      // Concurrently — the gateway does not serialise browser messages, and
      // reap time is charged to the 60s per-test timeout.
      const results = await Promise.allSettled(delta.map((id) => shutdownSession(bus, id)));
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        console.warn(`[reap] ${failed.length}/${delta.length} shutdowns errored (diagnostic)`);
      }
    }

    // ---- BUDGET (D5) --------------------------------------------------
    // Filter to PROCESS-BACKED sessions. Counting lingering closed records
    // made this fire on nearly every test while the container was in fact
    // healthy — a budget that cries wolf teaches everyone to ignore it.
    const live: SessionLike[] = bus.read
      .sessions()
      .map((s) => ({ id: s.id, cwd: s.cwd, live: s.live, status: s.status }))
      .filter(isLiveSession);
    const budget = checkBudget(live, RESIDUAL_SESSION_BUDGET);
    if (!budget.ok) {
      // A breach IS attributable to this spec, so it is reported loudly.
      // It is annotated rather than thrown so it cannot mask the spec's own
      // failure; the budget's job is attribution, and the memory bound
      // itself is verified by the acceptance run's `memory.current`.
      console.error(`[reap] ${budget.message}`);
      testInfo.annotations.push({ type: "residual-session-budget", description: budget.message });
    }
  } catch (err) {
    console.warn(`[reap] teardown failed (diagnostic only): ${String(err)}`);
  } finally {
    client?.close();
  }
}

/** Sticky verdicts and describe-scope releases that precede the probe. */
async function prepareTest(testFile: string): Promise<void> {
  // A worker-start failure (rejected operator credential) fails the worker's
  // first test exactly once; the latch it armed then skips everything else.
  if (workerStartFailure) {
    const message = workerStartFailure;
    workerStartFailure = undefined;
    throw new Error(message);
  }
  // A refusal latch outlives the worker that observed it: Playwright discards
  // a worker after a failed test, so module state alone is not sticky.
  const persistedRefusal = readRefusalLatch();
  if (persistedRefusal && !latch.refused) latch.refuse(persistedRefusal);

  // A describe-scope narrowing lives until its spec file's last test; the
  // first test of another file releases it (restore, then reap the group).
  const staleFailures = await releaseNarrowings((r) => r.scope === "describe" && r.ownerFile !== testFile);
  if (staleFailures.length > 0) console.warn(`[reap] describe-scope restore failed: ${staleFailures.join("; ")}`);
}

export const test = base.extend<{ reapSessions: void }, { trustBaselineAtWorkerStart: void }>({
  // D3 L2 — worker-scoped, runs before the worker's first test AND before any
  // `beforeAll` (worker fixtures set up first), so a describe-scope narrowing is
  // never snapshotted from an already-narrowed harness.
  trustBaselineAtWorkerStart: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright's fixture API mandates the destructuring pattern; this fixture has no dependencies.
    async ({}, use) => {
      await reassertBaselineAtWorkerStart();
      await use();
    },
    { scope: "worker", auto: true },
  ],
  reapSessions: [
    // Playwright REQUIRES the first argument to be an object-destructuring
    // pattern — it reads the destructured names to build the fixture dependency
    // graph, and rejects a plain parameter at runtime with "First argument must
    // use the object destructuring pattern". This fixture depends on no other
    // fixture, so the pattern is necessarily empty. Destructuring an unrelated
    // fixture (e.g. `page`) purely to satisfy the lint would be worse: it would
    // declare a dependency that does not exist and instantiate it for every
    // test, including the headless bus specs that never open a browser.
    // biome-ignore lint/correctness/noEmptyPattern: Playwright's fixture API mandates the destructuring pattern; this fixture has no dependencies.
    async ({}, use, testInfo) => {
      // ---- BEFORE BODY: sticky verdicts, stale narrowings, probe, latch --
      await prepareTest(testInfo.file);

      // Probe FIRST so a CI retry (`retries: 1`) of a harness-down test
      // re-probes and fails again rather than reporting as a misleading skip.
      const probeOk = await probeHarness();
      // Ordering lives in `decideGate` (pure, L1-tested): the ARMING probe
      // fails loudly once, later failures skip, and an armed latch whose fresh
      // probe succeeds still RUNS — a retry that re-probes healthy carries real
      // information and must not be failed with a harness-down message. A
      // refusal latch is the exception: sticky, never re-probed (decision E4).
      const gate = decideGate(latch, probeOk);

      if (gate.action === "fail") {
        // The one loud announcement of the harness's death. The test running at
        // the moment of death fails on its own assertions (its probe passed), so
        // the honest guarantee is "at most one additional failure, then skips".
        throw new Error(gate.message);
      }
      if (gate.action === "skip") {
        testInfo.skip(true, gate.message);
        await use();
        return;
      }

      // ---- PRE-TEST TRUST READ, leak check, PRE-SNAPSHOT -----------------
      const baselineFile = readBaselineFile();
      const preTrust = await readPreTrust(baselineFile);
      await failOnTrustLeak(baselineFile, preTrust);
      const { pre, preOk } = await takePreSnapshot(baselineFile);

      testBodyActive = true;
      await use();
      testBodyActive = false;

      // ---- RESTORE, then TRIPWIRE (sequential: no teardown-order assumption)
      const isolationFailures = await restoreAndTripwire(baselineFile, preTrust, testInfo.file);

      // ---- AFTER BODY: settle, reap the delta, budget ---------------------
      // `!preOk`: no trustworthy baseline → no safe delta.
      if (preOk) await reapAfterBody(pre, testInfo);

      // Last, so reaping and the budget always ran: fail the OWNING test.
      if (isolationFailures.length > 0) throw new Error(isolationFailures.join("\n"));
    },
    { auto: true },
  ],
});
