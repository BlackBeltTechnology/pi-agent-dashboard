/**
 * Host-lifecycle regressions for the log sink (PR #784 review):
 *   - print/JSON hosts (pi's noOpUIContext) must keep console output;
 *   - after reload/newSession/fork the newest context's UI wins.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as log from "../log.js";

/** Mirrors pi's runner ctx: `ui` / `hasUI` getters guarded by assertActive(). */
function makeCtx(opts: { hasUI: boolean; notify: (...a: unknown[]) => void }) {
  let active = true;
  const ctx = {
    get ui() {
      if (!active) throw new Error("stale extension context");
      return { notify: opts.notify };
    },
    get hasUI() {
      if (!active) throw new Error("stale extension context");
      return opts.hasUI;
    },
  };
  return { ctx, invalidate: () => (active = false) };
}

describe("log sink — host lifecycle", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log.resetUiSink();
    delete process.env.PI_IMAGE_FIT_QUIET;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    log.resetUiSink();
  });

  it("#1 print/JSON mode (hasUI:false, no-op notify) keeps console output", () => {
    // pi's noOpUIContext: notify is a function that does nothing.
    const { ctx } = makeCtx({ hasUI: false, notify: () => {} });
    log.useUiSink(ctx);

    log.info("telemetry");
    log.warn("trouble");

    expect(logSpy).toHaveBeenCalledWith("telemetry");
    expect(warnSpy).toHaveBeenCalledWith("trouble");
  });

  it("#2 after reload/newSession/fork the newest context wins", () => {
    const oldNotify = vi.fn();
    const newNotify = vi.fn();
    const first = makeCtx({ hasUI: true, notify: oldNotify });
    log.useUiSink(first.ctx);

    // pi >=0.84: runner.invalidate() makes the old ctx stale; a fresh ctx
    // arrives on the next event of the replacement session.
    first.invalidate();
    const second = makeCtx({ hasUI: true, notify: newNotify });
    log.useUiSink(second.ctx);

    log.info("telemetry");

    expect(oldNotify).not.toHaveBeenCalled();
    expect(newNotify).toHaveBeenCalledWith("telemetry", "info");
  });
});
