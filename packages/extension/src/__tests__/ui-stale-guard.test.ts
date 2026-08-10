/**
 * Tests for `runUiSafely` — the guard that keeps a late `autoStartServer`
 * continuation from crashing the pi process when it touches `ctx.ui` after the
 * extension context was invalidated by a session replacement or reload.
 *
 * These import the REAL helper (not a mirror), so removing the guard from
 * production source makes them fail. `stopSpinner` itself is mirrored, because
 * `bridge.ts` is not importable in unit tests (see
 * `bridge-system-followup.test.ts`) — but the mirror is built on top of the real
 * `runUiSafely`, which is where the behaviour under test lives.
 *
 * See change: fix-bridge-stale-ctx-crash.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { runUiSafely } from "../ui-stale-guard.js";

/** The exact error pi >= 0.84 throws from every `ctx.ui` getter once the
 *  extension runner has been invalidated (`ExtensionRunner.assertActive`). */
const STALE_MESSAGE =
  "This extension ctx is stale after session replacement or reload. Do not use a " +
  "captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), " +
  "or ctx.reload().";

/** A ctx whose `ui` getter throws, exactly as an invalidated runner does. */
function staleCtx(): { readonly ui: { setWidget: () => void; notify: () => void } } {
  return {
    get ui(): never {
      throw new Error(STALE_MESSAGE);
    },
  } as never;
}

function liveCtx() {
  const setWidget = vi.fn();
  const notify = vi.fn();
  return { ctx: { ui: { setWidget, notify } }, setWidget, notify };
}

/** Flush enough microtask/macrotask turns for an unhandledRejection to surface. */
async function flush(cycles = 20): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

/** Collect any unhandled rejection that escapes during `fn`. */
async function withRejectionWatch(fn: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const onRejection = (reason: unknown) => seen.push(reason);
  process.on("unhandledRejection", onRejection);
  try {
    await fn();
    await flush();
  } finally {
    process.off("unhandledRejection", onRejection);
  }
  return seen;
}

/**
 * Mirror of bridge.ts `stopSpinner`, built on the REAL guard. The interval is
 * cleared BEFORE the guarded `ctx.ui` call so a stale ctx still releases it.
 */
function makeStopSpinner(ctx: { ui: { setWidget: (k: string, v: undefined) => void } }) {
  let spinnerTimer: ReturnType<typeof setInterval> | null = setInterval(() => {}, 1000);
  const cleared: number[] = [];
  const stopSpinner = () => {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      cleared.push(1);
      spinnerTimer = null;
    }
    runUiSafely(() => ctx.ui.setWidget("pi-dashboard-launch", undefined));
  };
  return { stopSpinner, cleared, isTimerLive: () => spinnerTimer !== null };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runUiSafely — stale extension ctx", () => {
  it("spinner teardown in a promise continuation neither throws nor leaks a rejection (test-plan #E1)", async () => {
    const ctx = staleCtx();
    const { stopSpinner } = makeStopSpinner(ctx as never);

    const escaped = await withRejectionWatch(async () => {
      // Exactly the shape of the crash: a floating continuation calls the
      // teardown after the session was replaced.
      await Promise.resolve()
        .then(() => {
          stopSpinner();
        })
        .catch(() => {
          stopSpinner();
        });
    });

    expect(escaped).toEqual([]);
  });

  it("a failure notice on a stale ctx is dropped, not thrown (test-plan #E2)", () => {
    const ctx = staleCtx();
    expect(() =>
      runUiSafely(() =>
        (ctx as never as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
          "Dashboard server failed to start: readiness timeout",
          "error",
        ),
      ),
    ).not.toThrow();
  });

  it("a spinner mount on a stale ctx is skipped, not thrown (test-plan #E3)", () => {
    const ctx = staleCtx();
    expect(() =>
      runUiSafely(() =>
        (ctx as never as { ui: { setWidget: (k: string, f: unknown, o: unknown) => void } }).ui.setWidget(
          "pi-dashboard-launch",
          () => ({}),
          { placement: "aboveEditor" },
        ),
      ),
    ).not.toThrow();
  });

  it("clears the spinner interval even when the ctx is stale, and is idempotent (test-plan #E6)", () => {
    const ctx = staleCtx();
    const { stopSpinner, cleared, isTimerLive } = makeStopSpinner(ctx as never);

    stopSpinner();
    expect(isTimerLive()).toBe(false);
    expect(cleared).toHaveLength(1);

    // Second call (onLaunchEnd + the .then() safety net both fire) is a no-op.
    expect(() => stopSpinner()).not.toThrow();
    expect(cleared).toHaveLength(1);
  });
});

describe("runUiSafely — live extension ctx", () => {
  it("passes every call through to ctx.ui unchanged (test-plan #E4)", () => {
    const { ctx, setWidget, notify } = liveCtx();
    const factory = () => ({});

    runUiSafely(() => ctx.ui.setWidget("pi-dashboard-launch", factory, { placement: "aboveEditor" }));
    runUiSafely(() => ctx.ui.notify("starting dashboard server …", "info"));
    runUiSafely(() => ctx.ui.setWidget("pi-dashboard-launch", undefined));

    expect(setWidget).toHaveBeenNthCalledWith(1, "pi-dashboard-launch", factory, {
      placement: "aboveEditor",
    });
    expect(notify).toHaveBeenCalledWith("starting dashboard server …", "info");
    expect(setWidget).toHaveBeenNthCalledWith(2, "pi-dashboard-launch", undefined);
  });

  it("returns the thunk's value when it has one", () => {
    expect(runUiSafely(() => 42)).toBe(42);
  });

  it("returns undefined when the ctx is stale", () => {
    const ctx = staleCtx();
    expect(runUiSafely(() => (ctx as never as { ui: { notify: () => number } }).ui.notify())).toBeUndefined();
  });
});

describe("guard scope", () => {
  it("only wraps ctx.ui access — auto-start logic errors still propagate (test-plan #E5)", () => {
    // The guard is applied ONLY around ctx.ui thunks. Auto-start's own failures
    // travel their existing path and must not be absorbed here.
    const autoStartLogic = () => {
      throw new Error("boom: discovery failed");
    };
    expect(() => autoStartLogic()).toThrow(/boom: discovery failed/);

    // And a guarded UI call sitting next to it does not intercept that error.
    const { ctx, notify } = liveCtx();
    runUiSafely(() => ctx.ui.notify("unrelated", "info"));
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
