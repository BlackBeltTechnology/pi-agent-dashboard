import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { recordMeasurement } from "./helpers/evidence-path.js";
import {
  collectSubagentWire,
  type SubagentFrameSample,
  type SubagentWireCollector,
  sendPrompt,
  spawnFreshGitSession,
} from "./helpers/index.js";

/**
 * L3 rows for the open-inspector PULL path (change:
 * verify-subagent-pull-under-load). Verifies the four scenarios
 * `reduce-subagent-details-payload` shipped UNVERIFIED: F1 (a mounted inspector
 * converges on a growing timeline), P4 (the cadence costs no more than the push
 * it replaced), P5 (a representative inspector-open share) and X1 (a run killed
 * with no terminal frame).
 *
 * SUBSTRATE — the synthetic Agent-tick producer with its two pull-path
 * sentinels (`qa/fixtures/faux-agent-ticks.ext.ts`, scenario
 * `subagent-watched-growth`): a 12 s run whose timeline grows 5 -> 30 over the
 * first ~3 s and then PLATEAUS for ~9 s, emitting `subagents:*` bus frames
 * coalesced at the real producer's 250 ms. A nested faux subagent cannot be
 * used — it dies after ~2 no-op turns (see reduce-bridge-tick-bandwidth
 * measurement.md), which is precisely why the parent's four scenarios were
 * unverifiable.
 *
 * WHY THE PLATEAU IS LOAD-BEARING: terminal frames are NEVER stripped, so if
 * the timeline only reached 30 at the last tick, the rendered count would
 * converge on `subagents:completed` and F1 would pass with the pull path never
 * running. The ~9 s plateau (>= 3 cadence intervals at CADENCE_BASE_MS = 2000)
 * is what lets the count converge WHILE THE AGENT IS STILL RUNNING.
 *
 * ANTI-VACUITY — every row keys on `__resyncRequestId`, not on eventType: a
 * resync reply and a pushed frame are BOTH `subagent_started`, so eventType
 * cannot tell them apart.
 *
 * HARNESS ARM — this producer SHADOWS the real subagents `Agent` tool
 * (first-registration-wins), so it is staged ONLY under `PI_SYNTH_AGENT_TICKS=1`.
 * This spec self-skips otherwise. Run it on its own arm:
 *
 *   PI_E2E_SEED=1 PI_TEST_PEERS=both PI_SYNTH_AGENT_TICKS=1 ./docker/test-up.sh -d
 *   PORT=$(jq -r '.dashboardPort' .pi-test-harness.json)
 *   PW_E2E_USE_RUNNING=1 PW_E2E_PORT=$PORT PI_SYNTH_AGENT_TICKS=1 PW_CHANNEL=chrome \
 *     npx playwright test subagent-pull-under-load
 *   ./docker/test-down.sh
 *
 * The PUSH arm of P4 (and the F4 anti-vacuity inversion) needs a SECOND harness
 * start with `PI_DASHBOARD_SUBAGENT_STRIP=0` — the bridge reads that env per
 * call, but a container env var is fixed for the life of the harness. Those
 * rows self-skip on the arm they do not belong to.
 */

const WATCHED = "[[faux:subagent-watched-growth]] go";
/** Bus-cadence flanks for the P4 sensitivity table (250 ms = production-matched). */
const WATCHED_BY_BUS: Record<number, string> = {
  100: "[[faux:subagent-watched-growth-bus100]] go",
  250: WATCHED,
  1000: "[[faux:subagent-watched-growth-bus1000]] go",
};
const START_ENTRIES = 5;
const END_ENTRIES = 30;
/** Matches the fixture's entry text, so a DOM count needs no production hook. */
const ENTRY_TEXT = /^faux-entry \d+$/;
const CADENCE_BASE_MS = 2_000;
/** Resolved at write time — the change may be active or already archived. */
const CHANGE_NAME = "verify-subagent-pull-under-load";

/** True on the harness start that disables the bridge strip (the push arm). */
const STRIP_OFF = process.env.PI_DASHBOARD_SUBAGENT_STRIP === "0";

/** Append one recorded measurement so heap-evidence.md is transcribed, not invented. */
function record(key: string, value: unknown): void {
  recordMeasurement(CHANGE_NAME, key, value);
}

/** Start a watched run and return its session id + wire collector. */
async function startWatchedRun(
  page: Page,
  prompt: string = WATCHED,
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

/** Sum bytes/s over a window, split by the resync-reply discriminator. */
function byteRates(
  wire: SubagentWireCollector,
  agentId: string,
  t0: number,
  windowMs: number,
): { replyBytesPerSec: number; pushBytesPerSec: number; repliesPerSec: number; frames: number } {
  const inWindow = wire.forAgent(agentId).filter((f) => f.at >= t0 && f.at <= t0 + windowMs);
  const replies = inWindow.filter((f) => f.resyncRequestId !== undefined);
  const pushes = inWindow.filter((f) => f.resyncRequestId === undefined);
  const per = (n: number) => (n / windowMs) * 1000;
  return {
    replyBytesPerSec: per(replies.reduce((a, f) => a + f.bytes, 0)),
    pushBytesPerSec: per(pushes.reduce((a, f) => a + f.bytes, 0)),
    repliesPerSec: per(replies.length),
    frames: inWindow.length,
  };
}

/** Read the page-global inspector-open telemetry (cumulative, no exposed reset). */
async function readInspectorShare(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const fn = (globalThis as Record<string, unknown>).__piSubagentInspectorTelemetry as
      | (() => unknown)
      | undefined;
    return fn ? fn() : null;
  });
}

/**
 * The agentId of THIS run, resolved off the wire (never guessed).
 *
 * `seen` excludes agents from EARLIER runs on the same session: the measurement
 * rows re-prompt one session instead of spawning a fresh one per run (nine
 * session spawns saturate the shared single-container harness, and a saturated
 * harness would masquerade as a byte-rate result).
 */
async function resolveAgentId(
  wire: SubagentWireCollector,
  sessionId: string,
  seen: Set<string> = new Set(),
): Promise<string> {
  const fresh = () =>
    wire.frames.filter((f) => f.sessionId === sessionId && f.agentId && !seen.has(f.agentId));
  await expect.poll(() => fresh().length, { timeout: 90_000, intervals: [250] }).toBeGreaterThan(0);
  const id = fresh()[0]!.agentId;
  seen.add(id);
  return id;
}

/** Mount the inline inspector (the "Details" pill) for the watched subagent. */
async function mountInspector(page: Page): Promise<Locator> {
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
  return details;
}

/** Rendered timeline entries currently in the DOM. */
const renderedEntries = (page: Page) => page.getByText(ENTRY_TEXT);

/** A frame is TERMINAL for the watched agent. */
const isTerminal = (f: SubagentFrameSample): boolean =>
  f.eventType === "subagent_completed" ||
  f.eventType === "subagent_failed" ||
  f.eventType === "tool_execution_end" ||
  f.status === "completed" ||
  f.status === "failed";

test.describe("subagent pull path under load (synthetic watched-growth substrate)", () => {
  test.skip(
    process.env.PI_SYNTH_AGENT_TICKS !== "1",
    "requires the PI_SYNTH_AGENT_TICKS=1 harness arm (synthetic Agent tool shadows the real subagents Agent tool)",
  );

  test("F1/F2/F3/F5/F6/F7: a mounted inspector converges via the CADENCE, not via a push or a terminal frame", async ({
    page,
  }) => {
    test.skip(STRIP_OFF, "the pull arm requires the strip ON (default harness)");
    test.setTimeout(240_000);

    const { wire, sessionId } = await startWatchedRun(page);
    const agentId = await resolveAgentId(wire, sessionId);

    // Mount BEFORE the timeline renders anything: the rendered count starts at
    // 0 (pushes are thin), so the inspector is watching a growing timeline.
    await mountInspector(page);

    // --- F1: the rendered count converges while the agent is NON-TERMINAL ----
    // Poll both together: the moment a terminal frame lands the row is over,
    // because a terminal frame is never stripped and would converge the count
    // by itself.
    let convergedAt = 0;
    let maxRendered = 0;
    await expect
      .poll(
        async () => {
          if (wire.forAgent(agentId).some(isTerminal)) return "terminal";
          const n = await renderedEntries(page).count();
          maxRendered = Math.max(maxRendered, n);
          if (n >= END_ENTRIES) convergedAt = Date.now();
          return n >= END_ENTRIES ? "converged" : `n=${n}`;
        },
        { timeout: 60_000, intervals: [250] },
      )
      .toBe("converged");
    expect(convergedAt, "converged before any terminal frame").toBeGreaterThan(0);

    const beforeConvergence = (f: SubagentFrameSample) => f.at <= convergedAt;
    const mine = wire.forAgent(agentId).filter(beforeConvergence);

    // --- F2: every PUSHED frame was thin -----------------------------------
    const fatPushes = mine.filter(
      (f) => f.resyncRequestId === undefined && !isTerminal(f) && f.entryCount > 0,
    );
    expect(
      fatPushes.map((f) => `${f.eventType}:${f.entryCount}`),
      "no non-terminal PUSH frame may carry a timeline (the strip is what makes the pull path load-bearing)",
    ).toEqual([]);

    // --- F3: at least one REPLY was fat -------------------------------------
    const replies = mine.filter((f) => f.resyncRequestId !== undefined);
    expect(replies.length, "at least one resync reply arrived").toBeGreaterThan(0);
    expect(
      replies.some((f) => f.entryCount > 0),
      "a resync reply carried a real timeline",
    ).toBe(true);

    // --- F5: the converging reply belongs to a CADENCE request --------------
    // Token equality, not ordering: a reconnect-driven `reason:"open"` reply
    // would satisfy mere ordering and prove nothing about the cadence.
    const cadenceIds = new Set(
      wire.requestsFor(agentId, "cadence").filter((r) => r.at <= convergedAt).map((r) => r.requestId),
    );
    expect(cadenceIds.size, "the mounted inspector fired at least one cadence resync").toBeGreaterThan(0);
    const convergingCadenceReply = replies.find(
      (f) => f.entryCount >= END_ENTRIES && cadenceIds.has(f.resyncRequestId!),
    );
    expect(
      convergingCadenceReply,
      "the reply that carried the full timeline was answering a CADENCE request",
    ).toBeTruthy();

    // --- F6: an open-time reply cannot explain the convergence --------------
    // The open-time trigger DOES fire here (the rendered timeline is empty at
    // mount, so `emptyTimeline` holds, and App.tsx also resyncs on subscribe).
    // Ruled out by CONTENT, not by ordering: every reply answering an
    // open-time request is inspected, and none of them carried enough of the
    // timeline to explain the converged count. A wall-clock "the cadence reply
    // came later" check would be satisfied trivially and prove nothing.
    const opens = wire.requestsFor(agentId, "open").filter((r) => r.at <= convergedAt);
    const openIds = new Set(opens.map((r) => r.requestId));
    const openReplyMax = Math.max(
      0,
      ...replies.filter((f) => openIds.has(f.resyncRequestId!)).map((f) => f.entryCount),
    );
    expect(
      openReplyMax,
      "no open-time reply carried the full timeline, so it cannot explain the convergence",
    ).toBeLessThan(END_ENTRIES);
    // Stronger than the count bound alone (which an open reply carrying 29
    // would satisfy): the reply that ACTUALLY carried the converged timeline is
    // identified by token, and that token is not one of the open-time requests.
    expect(
      openIds.has(convergingCadenceReply!.resyncRequestId!),
      "the reply that carried the converged timeline answered a CADENCE request, not an open-time one",
    ).toBe(false);

    // --- F7: the terminal frame neither loses nor duplicates the timeline ---
    // Asserted where it is decidable. OBSERVED: on completion the finished Agent
    // row is re-grouped into a tool-burst-group header and the inline body is no
    // longer reachable at all (no Details pill in the completed row) — so a
    // post-terminal DOM count would assert that GROUPING behaviour, not this
    // change's claim, and would hang waiting for a control that never appears.
    // The claim itself is asserted on the terminal frame's own payload plus the
    // no-duplication bound the DOM did honour while it was mounted.
    await expect
      .poll(() => wire.forAgent(agentId).some(isTerminal), { timeout: 90_000, intervals: [500] })
      .toBe(true);
    const terminal = wire.forAgent(agentId).filter(isTerminal).filter((f) => f.entryCount > 0);
    expect(terminal.length, "the terminal frame is fat (never stripped)").toBeGreaterThan(0);
    for (const f of terminal) {
      expect(f.entryCount, `terminal ${f.eventType} carries exactly the final timeline`).toBe(
        END_ENTRIES,
      );
    }
    expect(maxRendered, "the rendered timeline never exceeded the produced one").toBeLessThanOrEqual(
      END_ENTRIES,
    );

    record("F1", {
      convergedBeforeTerminal: true,
      pushFramesObserved: mine.filter((f) => f.resyncRequestId === undefined).length,
      fatPushFrames: fatPushes.length,
      repliesObserved: replies.length,
      cadenceRequests: cadenceIds.size,
      openRequests: opens.length,
      maxEntriesInAnyOpenTimeReply: openReplyMax,
      maxRenderedDuringRun: maxRendered,
      terminalFrameEntryCount: END_ENTRIES,
      observed:
        "on completion the Agent row is re-grouped into a tool-burst-group header with no reachable " +
        "Details pill, so the inline timeline unmounts. Pinned as observed; out of scope for this change.",
    });
  });

  test("F4: anti-vacuity — with the strip OFF the pushed frames are FAT", async ({ page }) => {
    test.skip(
      !STRIP_OFF,
      "requires the PI_DASHBOARD_SUBAGENT_STRIP=0 harness start (the push arm)",
    );
    test.setTimeout(240_000);

    const { wire, sessionId } = await startWatchedRun(page);
    const agentId = await resolveAgentId(wire, sessionId);

    // The SAME observation as F2 must INVERT. If it does not, the env switch is
    // unwired and every measurement in this spec is one arm measured twice.
    await expect
      .poll(
        () =>
          wire
            .forAgent(agentId)
            .filter((f) => f.resyncRequestId === undefined && !isTerminal(f) && f.entryCount > 0)
            .length,
        { timeout: 90_000, intervals: [250] },
      )
      .toBeGreaterThan(0);

    record("F4", { stripOffPushesAreFat: true });
  });

  test("X1/X2/X3: killed mid-run with no terminal frame, then replayed", async ({ page }) => {
    test.skip(STRIP_OFF, "the regression is a property of the strip-ON pull model");
    test.setTimeout(240_000);

    // X2 — UNWATCHED by construction. A single resync stores a FAT reply
    // (every event_forward is persisted and replies are never stripped), which
    // would show a mid-run timeline on replay and fail X1 for a reason that has
    // nothing to do with the regression. So: no inspector, and the session is
    // never SELECTED (App.tsx resyncs every running empty-timeline subagent on
    // subscribe).
    await page.goto("/");
    const wire = collectSubagentWire(page);
    const card = await spawnFreshGitSession(page);
    const sessionId = (await card.getAttribute("data-session-id")) ?? "";
    await card.click();
    await page.keyboard.press("Escape").catch(() => {});
    await sendPrompt(page, WATCHED);
    const agentId = await resolveAgentId(wire, sessionId);

    // Let a timeline accumulate on the producer side (thin on the wire).
    await expect
      .poll(() => wire.forAgent(agentId).length, { timeout: 90_000, intervals: [250] })
      .toBeGreaterThan(10);

    // Navigate AWAY so no inspector is mounted and no further open-resync can
    // fire while the run is killed.
    await page.goto("/");
    await page.waitForTimeout(500);

    expect(
      wire.requestsFor(agentId).map((r) => `${r.reason}:${r.requestId}`),
      "X2: an unwatched run must issue ZERO resync requests — a stored fat reply would fail X1 spuriously",
    ).toEqual([]);
    expect(
      wire.forAgent(agentId).some(isTerminal),
      "the run must still be mid-flight at kill time",
    ).toBe(false);

    // --- the kill ----------------------------------------------------------
    await page.evaluate((id) => {
      const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
      return new Promise<void>((resolve) => {
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "force_kill", sessionId: id }));
          setTimeout(() => {
            ws.close();
            resolve();
          }, 500);
        };
        ws.onerror = () => resolve();
      });
    }, sessionId);

    // --- the replay --------------------------------------------------------
    // `force_kill` closes the bridge WS BEFORE the signal, so socket silence is
    // not proof of anything. The decidable surface is the STORED transcript the
    // server re-sends on subscribe.
    // Address the ended session by ROUTE. An ended card is hidden behind its
    // folder's ended group in the list, and hunting that grouping would make the
    // row assert list behaviour instead of replay behaviour.
    const replay = collectSubagentWire(page);
    await page.goto(`/session/${sessionId}`);
    await page.waitForTimeout(8_000);

    const replayed = replay.forAgent(agentId);
    expect(replayed.length, "the killed run replayed some subagent state").toBeGreaterThan(0);

    // X3 — no terminal frame and no stored timeline for that agent.
    expect(
      replayed.filter(isTerminal).map((f) => f.eventType),
      "X3: a run killed mid-flight has no terminal frame in the store",
    ).toEqual([]);
    expect(
      replayed.filter((f) => f.entryCount > 0).map((f) => `${f.eventType}:${f.entryCount}`),
      "X3: no stored frame carries a timeline for the killed agent",
    ).toEqual([]);

    // The tick index is read from the REPLAY, not live: reading it live would
    // require subscribing during the run, which fires the open-resync X2 forbids.
    const tickIndexOf = (f: SubagentFrameSample): number => {
      const m = /\(running… (\d+)\)/.exec(JSON.stringify(f));
      return m ? Number(m[1]) : -1;
    };
    const lastTick = Math.max(-1, ...replayed.map(tickIndexOf));

    // X1 — scalar state renders, no mid-run timeline, neither blank nor corrupt.
    await expect(page.getByText(/watched growing subagent/i).first()).toBeVisible({
      timeout: 30_000,
    });
    expect(await renderedEntries(page).count(), "X1: no mid-run timeline is shown").toBe(0);
    const bodyText = (await page.locator("body").innerText()).trim();
    expect(bodyText.length, "X1: the render is not blank").toBeGreaterThan(0);
    expect(bodyText).not.toMatch(/subagent not found/i);

    record("X1", {
      killMechanism: "force_kill",
      resyncRequestsDuringRun: 0,
      replayedFrames: replayed.length,
      storedTerminalFrames: 0,
      storedTimelineFrames: 0,
      lastObservedTickIndex: lastTick,
      // Pinned as OBSERVED (V4): whatever the stuck-card supersede-heal does to
      // a killed Agent call is the baseline this row protects from drift.
      renderedEntryCount: 0,
    });
  });
});
