/**
 * Setup run timing under fake timers (test-plan #R2 timeout, #R3, #R5a, #R6):
 * the 60 s step limit, the 2 s policy continue, the 15 min checkpoint limit and
 * the 30 s keep-alive across a 20 min decision wait. Drives `SetupRun` directly
 * (no HTTP under fake timers). See change: add-gmail-auto-setup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advanceUntil, EXISTING, makeHarness, preset } from "../../__tests__/setup-harness.js";
import { SetupRun } from "../setup/run.js";
import { DEFAULT_TIMING, PATHS } from "../setup/steps.js";

beforeEach(() => {
  // setImmediate stays real so microtask-driven fakes and fastify still run.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

async function startRun(h: Awaited<ReturnType<typeof makeHarness>>) {
  const run = new SetupRun(h.deps, { mode: EXISTING.mode, projectId: EXISTING.projectId, ownerEmail: EXISTING.ownerEmail });
  run.start();
  await advanceUntil(() => false, 1); // let the connection and first steps settle
  return run;
}

describe("R2 step limit: a step that hangs 61 s", () => {
  it("hand-off timeout @ client / 4 — not before 60 s, and never earlier than the step started", async () => {
    const h = await makeHarness({ timing: DEFAULT_TIMING });
    preset(h.console, "publish");
    // Every AX query on the client-create page hangs (a stuck console).
    h.console.hang = (method, u) => method === "Accessibility.queryAXTree" && u.pathname === PATHS.clientCreate;
    const run = await startRun(h);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(run.view().state).toBe("running");
    expect(run.view().step).toBe("client");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run.view()).toMatchObject({ state: "handoff", handoff: { step: "client", wizardStep: 4, reason: "timeout" } });
    await run.settled;
    expect(h.browser.calls.disconnect).toEqual(["inst-1"]);
    expect(h.logger.lines.some((l) => /^\[gmail\] setup step client handoff:timeout \d+ms$/.test(l))).toBe(true);
  });

  it("a long human wait does not count against the step limit (decision pending for 10 min, run then continues)", async () => {
    const h = await makeHarness({ timing: DEFAULT_TIMING });
    preset(h.console, "api");
    h.console.userType = null;
    const run = await startRun(h);
    await advanceUntil(() => run.view().state === "waiting_decision", 5_000);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(run.view().state).toBe("waiting_decision");
    expect(run.continue({ audience: "external" })).toEqual({ ok: true });
    await advanceUntil(() => run.view().state === "waiting_user", 10_000);
    expect(run.view().checkpoint).toEqual({ kind: "policy" });
  });
});

describe("R3 policy checkpoint", () => {
  it("waits for the user's tick, never clicks the box, continues within 2 s of the tick", async () => {
    const h = await makeHarness({ timing: DEFAULT_TIMING });
    preset(h.console, "api");
    h.console.userType = null;
    let ticked = 0;
    // The human ticks the box 30 s after it is first shown.
    h.console.onPolicyBoxQueried = () => {
      setTimeout(() => {
        h.console.policyChecked = true;
        ticked = Date.now();
      }, 30_000);
    };
    const run = await startRun(h);
    await advanceUntil(() => run.view().state === "waiting_decision", 5_000);
    run.continue({ audience: "external" });
    await advanceUntil(() => run.view().state === "waiting_user", 10_000);
    expect(run.view().checkpoint).toEqual({ kind: "policy" });
    const shown = Date.now();

    await vi.advanceTimersByTimeAsync(29_000);
    expect(run.view()).toMatchObject({ state: "waiting_user", checkpoint: { kind: "policy" } });
    expect(h.console.policyChecked).toBe(false);
    expect(h.console.commands("Page.bringToFront").length).toBeGreaterThan(0); // the window is raised for the user

    await advanceUntil(() => ticked > 0, 5_000, 100);
    expect(ticked - shown).toBeGreaterThanOrEqual(30_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run.view().checkpoint).toBeUndefined();
    expect(run.view().state).not.toBe("waiting_user");
    // The click that follows is on "Continue", never on the checkbox.
    await advanceUntil(() => h.console.clicks.includes("button:Create"), 5_000);
    expect(h.console.clicks.filter((c) => c.startsWith("checkbox:"))).toEqual([]);
    expect(h.console.clicks.slice(-3)).toContain("button:Continue");
  });
});

describe("R5a checkpoint timeout", () => {
  it("console_terms never cleared → waiting for 15 min, then hand-off timeout", async () => {
    const h = await makeHarness({ timing: DEFAULT_TIMING });
    preset(h.console, "publish");
    h.console.termsPending = true;
    const run = await startRun(h);
    await advanceUntil(() => run.view().state === "waiting_user", 5_000);
    expect(run.view().checkpoint).toEqual({ kind: "console_terms" });
    await vi.advanceTimersByTimeAsync(14 * 60_000);
    expect(run.view().state).toBe("waiting_user"); // the 60 s step limit does not apply to a human wait
    await vi.advanceTimersByTimeAsync(61_000);
    expect(run.view()).toMatchObject({ state: "handoff", handoff: { step: "project", wizardStep: 1, reason: "timeout" } });
    await run.settled;
    expect(h.browser.calls.disconnect).toEqual(["inst-1"]);
  });

  it("the user clears the terms within the limit → the run goes on", async () => {
    const h = await makeHarness({ timing: DEFAULT_TIMING });
    preset(h.console, "publish");
    h.console.termsPending = true;
    const run = await startRun(h);
    await advanceUntil(() => run.view().state === "waiting_user", 5_000);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    h.console.termsPending = false;
    await advanceUntil(() => run.view().state === "done", 30_000);
    expect(run.view().state).toBe("done");
  });
});

describe("R6 keep-alive", () => {
  it("a client command every 30 s across a 20 min decision wait; the socket stays open; the answer is still honoured", async () => {
    const h = await makeHarness({ timing: DEFAULT_TIMING });
    preset(h.console, "api");
    h.console.userType = null;
    const run = await startRun(h);
    await advanceUntil(() => run.view().state === "waiting_decision", 5_000);
    const before = h.console.keepAlives.length;
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(run.view().state).toBe("waiting_decision");
    expect(h.console.socketClosed).toBe(false);
    const pings = h.console.keepAlives.slice(before);
    expect(pings).toHaveLength(40);
    pings.slice(1).forEach((t, i) => expect(t - (pings[i] as number)).toBe(30_000));
    // The 20 min wait did not lose the run: the answer proceeds to the form.
    expect(run.continue({ audience: "external" })).toEqual({ ok: true });
    await advanceUntil(() => run.view().state === "waiting_user", 10_000);
    expect(run.view().checkpoint).toEqual({ kind: "policy" });
  });

  it("keep-alive also runs in a checkpoint wait, and stops once the run ends", async () => {
    const h = await makeHarness({ timing: DEFAULT_TIMING });
    preset(h.console, "publish");
    h.console.termsPending = true;
    const run = await startRun(h);
    await advanceUntil(() => run.view().state === "waiting_user", 5_000);
    const before = h.console.keepAlives.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(h.console.keepAlives.length - before).toBe(10);
    await run.cancel();
    const after = h.console.keepAlives.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(h.console.keepAlives.length).toBe(after);
  });
});
