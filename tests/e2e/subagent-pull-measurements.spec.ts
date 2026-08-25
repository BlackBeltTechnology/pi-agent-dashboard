import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import {
  collectSubagentWire,
  type SubagentWireCollector,
  sendPrompt,
  spawnFreshGitSession,
} from "./helpers/index.js";

/**
 * MEASUREMENT rows for the subagent pull path (change:
 * verify-subagent-pull-under-load — scenarios P1/P2/P3/P4).
 *
 * These are RECORDED EVIDENCE, not CI gates: the deliverable is a number written
 * to `measurements.json` and transcribed into `heap-evidence.md`. They are split
 * out of `subagent-pull-under-load.spec.ts` and gated on `PI_E2E_MEASURE=1`
 * because each row spawns several sessions and holds several browser contexts —
 * on the shared single-container harness that is minutes of wall clock, and
 * bundling them with the behavioural rows blew the global teardown budget.
 *
 * Every row spawns a FRESH session per measured run. Re-prompting one session is
 * cheaper but does NOT reliably produce a second subagent in this harness, and a
 * silent zero would be transcribed into the evidence file as if it were data —
 * so each row asserts that every arm actually produced frames.
 *
 * Two harness starts are required:
 *   pull arm:  PI_E2E_SEED=1 PI_TEST_PEERS=both PI_SYNTH_AGENT_TICKS=1 ./docker/test-up.sh -d
 *   push arm:  ... plus PI_DASHBOARD_SUBAGENT_STRIP=0
 * then, against the derived `.pi-test-harness.json` port:
 *   PW_E2E_USE_RUNNING=1 PW_E2E_PORT=$PORT PI_SYNTH_AGENT_TICKS=1 PI_E2E_MEASURE=1 \
 *     PW_CHANNEL=chrome npx playwright test subagent-pull-measurements \
 *     --global-timeout=2400000
 *
 * `--global-timeout` is REQUIRED: the config default is 15 min, and these rows
 * spawn a session per measured run. Without it the run aborts mid-suite and
 * reports "did not run" rather than a real failure.
 */

const WATCHED_BY_BUS: Record<number, string> = {
  100: "[[faux:subagent-watched-growth-bus100]] go",
  250: "[[faux:subagent-watched-growth]] go",
  1000: "[[faux:subagent-watched-growth-bus1000]] go",
};
const EVIDENCE_PATH = "openspec/changes/verify-subagent-pull-under-load/measurements.json";
const STRIP_OFF = process.env.PI_DASHBOARD_SUBAGENT_STRIP === "0";
/** Fixture runtime: 240 ticks @ 50 ms. */
const RUNTIME_MS = 12_000;
const WINDOW_MS = 6_000;

function record(key: string, value: unknown): void {
  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(readFileSync(EVIDENCE_PATH, "utf8")) as Record<string, unknown>;
  } catch {
    /* first write */
  }
  current[key] = value;
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(current, null, 2)}\n`);
}

async function startWatchedRun(
  page: Page,
  prompt: string,
): Promise<{ wire: SubagentWireCollector; sessionId: string }> {
  await page.goto("/");
  const wire = collectSubagentWire(page);
  const card = await spawnFreshGitSession(page);
  const sessionId = (await card.getAttribute("data-session-id")) ?? "";
  await card.click();
  await page.keyboard.press("Escape").catch(() => {});
  await sendPrompt(page, prompt);
  return { wire, sessionId };
}

async function resolveAgentId(
  wire: SubagentWireCollector,
  sessionId: string,
  timeoutMs = 90_000,
): Promise<string | null> {
  const mine = () => wire.frames.filter((f) => f.sessionId === sessionId && f.agentId);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (mine().length > 0) return mine()[0]!.agentId;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

/**
 * Mount the inline inspector and return a collapse handle.
 *
 * The control's LABEL flips `Details` -> `Collapse` once expanded
 * (`AgentToolRenderer` CardControls), so the locator used to open it can never
 * close it — the collapse handle has to match the expanded label.
 */
async function mountInspector(page: Page): Promise<() => Promise<void>> {
  const details = page.getByRole("button", { name: /^Details$/ }).first();
  const toggles = page.getByRole("button", { name: /watched growing subagent/i });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await details.isVisible().catch(() => false)) break;
    const count = await toggles.count();
    for (let i = 0; i < count; i++) {
      if (await details.isVisible().catch(() => false)) break;
      await toggles.nth(i).click().catch(() => {});
    }
    await page.waitForTimeout(250);
  }
  await expect(details).toBeVisible({ timeout: 30_000 });
  await details.click();
  return async () => {
    const collapse = page.getByRole("button", { name: /^Collapse$/ }).first();
    await expect(collapse).toBeVisible({ timeout: 15_000 });
    await collapse.click();
  };
}

interface Rates {
  replyBytesPerSec: number;
  pushBytesPerSec: number;
  repliesPerSec: number;
  frames: number;
  toolCarrierFrames: number;
  busCarrierFrames: number;
}

function byteRates(
  wire: SubagentWireCollector,
  agentId: string,
  t0: number,
  windowMs: number,
): Rates {
  const inWindow = wire.forAgent(agentId).filter((f) => f.at >= t0 && f.at <= t0 + windowMs);
  // Classify by the `__resyncRequestId` discriminator, NEVER by eventType: a
  // reply and a pushed frame are both `subagent_started`.
  const replies = inWindow.filter((f) => f.resyncRequestId !== undefined);
  const pushes = inWindow.filter((f) => f.resyncRequestId === undefined);
  const per = (n: number) => (n / windowMs) * 1000;
  return {
    replyBytesPerSec: per(replies.reduce((a, f) => a + f.bytes, 0)),
    pushBytesPerSec: per(pushes.reduce((a, f) => a + f.bytes, 0)),
    repliesPerSec: per(replies.length),
    frames: inWindow.length,
    toolCarrierFrames: inWindow.filter((f) => f.eventType === "tool_execution_update").length,
    busCarrierFrames: inWindow.filter((f) => f.eventType.startsWith("subagent_")).length,
  };
}

/** One measured run: fresh session, inspector mounted, N-1 extra subscribers. */
async function measureOnce(
  page: Page,
  context: BrowserContext,
  prompt: string,
  subscribers: number,
  attempt = 0,
  /**
   * Pull arms must also observe a NON-ZERO reply rate. `frames > 0` alone is
   * satisfied by pushes, so a silently-broken pull path would write
   * `replyBytesPerSec: 0` into the evidence file and the verdict
   * `0 <= push_removed` would "pass" trivially.
   */
  requireReplies = false,
): Promise<Rates> {
  const { wire, sessionId } = await startWatchedRun(page, prompt);
  const agentId = await resolveAgentId(wire, sessionId);
  if (agentId === null) {
    // A spawn that never registers is HOST contention (this harness shares the
    // machine with other test containers), not a product signal. Retry once,
    // then fail loudly rather than recording a silent zero.
    expect(attempt, "a fresh session produced no subagent twice in a row").toBeLessThan(1);
    // `requireReplies` MUST survive the retry: dropping it would let a pull arm
    // silently record `replyBytesPerSec: 0` on its second attempt.
    return measureOnce(page, context, prompt, subscribers, attempt + 1, requireReplies);
  }
  await mountInspector(page);
  const extras: Page[] = [];
  for (let i = 1; i < subscribers; i++) {
    const p = await context.newPage();
    await p.goto(`/session/${sessionId}`);
    extras.push(p);
  }
  const t0 = Date.now();
  await page.waitForTimeout(WINDOW_MS);
  const rates = byteRates(wire, agentId, t0, WINDOW_MS);
  for (const p of extras) await p.close();
  // Non-vacuity: a silent zero must never reach the evidence file as data.
  expect(rates.frames, "the measured window observed subagent frames").toBeGreaterThan(0);
  if (requireReplies) {
    expect(
      rates.repliesPerSec,
      "the pull arm observed resync REPLIES (a zero here would make the verdict vacuous)",
    ).toBeGreaterThan(0);
  }
  return rates;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const spread = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);

test.describe("subagent pull path — recorded measurements", () => {
  test.skip(
    process.env.PI_SYNTH_AGENT_TICKS !== "1",
    "requires the PI_SYNTH_AGENT_TICKS=1 harness arm",
  );
  test.skip(
    process.env.PI_E2E_MEASURE !== "1",
    "measurement rows are evidence collection — opt in with PI_E2E_MEASURE=1",
  );

  test("P1: harness ceiling for concurrent subscribers", async ({ page, context }) => {
    test.skip(STRIP_OFF, "the ceiling is measured once, on the default arm");
    test.setTimeout(600_000);

    // Measured, not assumed: without this, a saturated harness would masquerade
    // as a byte-rate result in P2.
    const samples: Array<{ n: number; frames: number }> = [];
    for (const n of [1, 3, 5]) {
      const rates = await measureOnce(page, context, WATCHED_BY_BUS[250]!, n);
      samples.push({ n, frames: rates.frames });
    }
    const baseline = samples[0]!.frames;
    const ceiling = Math.max(...samples.filter((s) => s.frames >= baseline * 0.8).map((s) => s.n));
    record("P1-harness-ceiling", { windowMs: WINDOW_MS, samples, baseline, ceiling });

    // `measureOnce` already fails an arm that produced nothing, so a ceiling
    // computed over a silently-empty arm cannot happen.
    expect(baseline).toBeGreaterThan(0);
    expect(ceiling).toBeGreaterThanOrEqual(1);
  });

  test("P2/P3 pull arm: reply byte rate + bus-cadence sensitivity", async ({ page, context }) => {
    test.skip(STRIP_OFF, "the pull arm requires the strip ON (default harness)");
    test.setTimeout(900_000);

    const N = 3;
    const rows: Array<Record<string, unknown>> = [];
    // 250 ms is the production-matched HEADLINE (3 runs -> median + spread);
    // 100/1000 are the sensitivity flanks (1 run each). A verdict that flips
    // across the flanks is itself the finding.
    const matrix: Array<[number, number]> = [
      [250, 3],
      [100, 1],
      [1000, 1],
    ];
    for (const [bus, runs] of matrix) {
      for (let run = 0; run < runs; run++) {
        rows.push({
          bus,
          run,
          N,
          ...(await measureOnce(page, context, WATCHED_BY_BUS[bus]!, N, 0, true)),
        });
      }
    }

    const headline = rows.filter((r) => r.bus === 250).map((r) => r.replyBytesPerSec as number);
    record("P2-P3-pull-arm", {
      windowMs: WINDOW_MS,
      N,
      rows,
      headline: {
        busIntervalMs: 250,
        replyBytesPerSecMedian: median(headline),
        replyBytesPerSecSpread: spread(headline),
      },
      note:
        "Pull = bytes/s of frames bearing __resyncRequestId, per subscriber. The bytes the strip " +
        "REMOVES are (push_stripOff - push_stripOn), the push arm coming from the separate " +
        "PI_DASHBOARD_SUBAGENT_STRIP=0 harness start. A verdict inside the run-to-run spread is " +
        "INCONCLUSIVE — a shippable outcome, since the measurement infrastructure is the deliverable.",
    });

    expect(headline.length, "the headline cadence was measured 3x").toBe(3);
  });

  test("P2/P3 push arm: subagent-carrying byte rate with the strip OFF", async ({
    page,
    context,
  }) => {
    test.skip(!STRIP_OFF, "requires the PI_DASHBOARD_SUBAGENT_STRIP=0 harness start");
    test.setTimeout(900_000);

    const N = 3;
    const rows: Array<Record<string, unknown>> = [];
    const matrix: Array<[number, number]> = [
      [250, 3],
      [100, 1],
      [1000, 1],
    ];
    for (const [bus, runs] of matrix) {
      for (let run = 0; run < runs; run++) {
        rows.push({ bus, run, N, ...(await measureOnce(page, context, WATCHED_BY_BUS[bus]!, N)) });
      }
    }

    const headline = rows.filter((r) => r.bus === 250).map((r) => r.pushBytesPerSec as number);
    record("P2-P3-push-arm", {
      windowMs: WINDOW_MS,
      N,
      rows,
      headline: {
        busIntervalMs: 250,
        pushBytesPerSecMedian: median(headline),
        pushBytesPerSecSpread: spread(headline),
      },
      note:
        "pushBytesPerSec EXCLUDES __resyncRequestId frames: the client still pulls in this arm, so " +
        "counting replies here would inflate 'the bytes the strip removes'. The push/pull subtraction " +
        "is only valid against a pull arm whose reply rate was non-zero (asserted there).",
    });

    expect(headline.length).toBe(3);
  });

  test("P4: inspector-open share across four watch patterns", async ({ page, context }) => {
    test.skip(STRIP_OFF, "the share is a client-side reading, measured on the default arm");
    // MUST stay below the config's `globalTimeout` (15 min). At 900_000 the two
    // budgets coincide, so the RUN aborted before the test could report and the
    // failure surfaced as "1 did not run" with no diagnostic at all. Four arms
    // need more than 15 min of wall clock on a loaded host, so this row is run
    // with an explicit `--global-timeout` (see the header).
    test.setTimeout(600_000);
    void page;

    // `__piSubagentInspectorTelemetry()` is a page-global CUMULATIVE aggregate
    // and `resetInspectorTelemetry` is NOT exposed on globalThis, so each arm
    // needs its OWN PAGE (a fresh JS realm resets the module-level state).
    // Sharing one page blends all four arms into a single meaningless number.
    const arms = [
      { id: "unwatched", pattern: "never opened", openAt: -1, holdFor: 0 },
      { id: "glance", pattern: "open at 25% of runtime, hold 25%", openAt: 0.25, holdFor: 0.25 },
      { id: "threshold", pattern: "open at 25% of runtime, hold 50%", openAt: 0.25, holdFor: 0.5 },
      { id: "watched", pattern: "open before the first entry, never closed", openAt: 0, holdFor: 1 },
    ];
    const readings: Array<Record<string, unknown>> = [];

    for (const arm of arms) {
      // eslint-disable-next-line no-console -- a 4-arm row is long; without a
      // progress line a stall is indistinguishable from a hang.
      console.log(`[P4] arm=${arm.id} (${arm.pattern})`);
      const p = await context.newPage();
      await startWatchedRun(p, WATCHED_BY_BUS[250]!);
      if (arm.openAt >= 0) {
        if (arm.openAt > 0) await p.waitForTimeout(RUNTIME_MS * arm.openAt);
        const collapse = await mountInspector(p);
        if (arm.holdFor < 1) {
          await p.waitForTimeout(RUNTIME_MS * arm.holdFor);
          await collapse(); // the inspector is no longer mounted
        }
      }
      await p.waitForTimeout(RUNTIME_MS);
      const telemetry = await p.evaluate(() => {
        const fn = (globalThis as Record<string, unknown>).__piSubagentInspectorTelemetry as
          | (() => unknown)
          | undefined;
        return fn ? fn() : null;
      });
      readings.push({ ...arm, runtimeMs: RUNTIME_MS, telemetry });
      await p.close();
    }

    record("P4-inspector-open-share", {
      note:
        "A scripted harness cannot yield a FIELD-representative share — the number is whatever the " +
        "watch pattern makes it. Each reading is reported WITH its pattern. The 50% arm sits ON the " +
        "C4 boundary by construction. The field number still comes from the production counter.",
      readings,
    });

    // Non-vacuity: the signal must MOVE across the spectrum, else a constant
    // would be transcribed into the evidence file as a measurement.
    const share = (r: Record<string, unknown>): number =>
      Number((r.telemetry as { share?: number } | null)?.share ?? -1);
    expect(share(readings[0]!), "the unwatched arm reads ~0").toBeLessThan(0.05);
    expect(share(readings[3]!), "the fully-watched arm reads high").toBeGreaterThan(0.5);
    expect(share(readings[3]!), "the share tracks how long the inspector was held").toBeGreaterThan(
      share(readings[1]!),
    );
  });
});
