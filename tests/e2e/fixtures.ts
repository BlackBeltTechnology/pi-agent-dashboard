/**
 * The browser-E2E `test` object. EVERY spec must import `test` (and `expect`)
 * from here rather than from `@playwright/test` — enforced by
 * `scripts/check-e2e-fixture-import.mjs`.
 *
 * What it adds, and why
 * ---------------------
 * The harness is ONE Docker container (4 GiB, `docker/compose.yml` `MEM_LIMIT`)
 * shared by all 87 specs. Specs spawn dashboard sessions from 138 call sites;
 * before this fixture, exactly one ever ended a session. Each session is a
 * separate OS process at 150–280 MB RSS, so the container crossed its ceiling
 * around 12–27 concurrent sessions, thrashed in reclaim, `/api/health` began
 * timing out, and the daemon died — after which every remaining spec failed in
 * ~400 ms against a dead port. That cascade is indistinguishable from mass
 * product regression, which is how issue #433 sat undiagnosed.
 *
 * Three behaviours, all automatic (`auto: true`, so there is no per-spec opt-in
 * and spec #88 cannot silently skip them):
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
 * See change: fix-e2e-harness-memory-exhaustion.
 */

import { test as base, expect } from "@playwright/test";
import { BusClient } from "@blackbelt-technology/pi-dashboard-bus-client";
import type { SessionRemovedMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { DASHBOARD_PORT, HEALTH_URL } from "./lifecycle.js";
import {
  HARNESS_DOWN_MESSAGE,
  RESIDUAL_SESSION_BUDGET,
  checkBudget,
  computeDelta,
  createLatch,
  isLiveSession,
  settleSessionIds,
  type SessionLike,
} from "./reap-core.js";

// Re-export `expect` plus EVERY type the 87 specs pull from the same statement.
// A missing re-export here breaks all 87 at once while the import guard still
// passes, so this list is type-checked by `npm run lint:e2e`, not eyeballed.
export { expect };
export type { APIRequestContext, Locator, Page, WebSocket } from "@playwright/test";

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

async function connectBus(): Promise<BusClient> {
  const client = new BusClient({ host: "localhost", port: DASHBOARD_PORT });
  await client.connect();
  return client;
}

/**
 * Shut down one session and await its `session_removed`.
 *
 * The ack is worth awaiting: `handleShutdown` broadcasts it as its LAST step,
 * after the SIGTERM→2s→SIGKILL ladder completes, so it means the process is
 * actually gone. Fire-and-forget would instead let dying sessions appear in the
 * next test's pre-snapshot and become permanent phantoms in every later delta.
 *
 * An unknown/already-gone session is success — `notify-channel.spec.ts`
 * force-kills its own session mid-test, and that must not be an error here.
 */
async function shutdownSession(client: BusClient, sessionId: string): Promise<void> {
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

export const test = base.extend<{ reapSessions: void }>({
  reapSessions: [
    // No destructuring: this fixture depends on no other fixture, and an empty
    // `{}` pattern trips biome's `noEmptyPattern` (a CI Tier A error).
    async (_fixtures, use, testInfo) => {
      // ---- BEFORE BODY: probe, then consult the latch --------------------
      // Probe FIRST so a CI retry (`retries: 1`) of a harness-down test
      // re-probes and fails again rather than reporting as a misleading skip.
      const probeOk = await probeHarness();
      const verdict = latch.record(probeOk);

      if (latch.shouldSkip({ probeOk })) {
        testInfo.skip(true, `${HARNESS_DOWN_MESSAGE} — skipping (see the first failure above).`);
        await use();
        return;
      }
      if (verdict.armed) {
        // The test that is running when the daemon dies fails on its own
        // assertions (its probe already passed), so the honest guarantee is
        // "at most one additional failure after the death, then skips".
        throw new Error(verdict.message);
      }

      // ---- PRE-SNAPSHOT ---------------------------------------------------
      let pre: string[] = [];
      let preClient: BusClient | undefined;
      try {
        preClient = await connectBus();
        pre = preClient.read.sessions().map((s) => s.id);
      } catch (err) {
        // Never fail a spec on reap bookkeeping — report and continue.
        console.warn(`[reap] pre-snapshot failed (continuing): ${String(err)}`);
      } finally {
        preClient?.close();
      }

      await use();

      // ---- AFTER BODY: settle, reap the delta, budget ---------------------
      // Every error below is swallowed and reported as a DIAGNOSTIC. When the
      // daemon dies mid-test the reap's connect()/send() throws
      // `bus client not connected`; surfacing that would replace the spec's
      // real assertion failure under exactly the condition the latch exists for.
      let client: BusClient | undefined;
      try {
        client = await connectBus();
        const bus = client;

        const post = await settleSessionIds(() => bus.read.sessions().map((s) => s.id));
        const delta = computeDelta(pre, post);

        if (delta.length > 0) {
          // Concurrently — the gateway does not serialise browser messages, and
          // reap time is charged to the 60s per-test timeout.
          const results = await Promise.allSettled(
            delta.map((id) => shutdownSession(bus, id)),
          );
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
    },
    { auto: true },
  ],
});
