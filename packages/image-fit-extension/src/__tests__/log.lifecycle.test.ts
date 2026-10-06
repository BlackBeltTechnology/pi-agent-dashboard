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

describe("log sink — channel routing", () => {
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
    delete process.env.PI_IMAGE_FIT_QUIET;
  });

  it("info goes to the footer status, not a notification", () => {
    const notify = vi.fn();
    const setStatus = vi.fn();
    log.useUiSink({ hasUI: true, ui: { notify, setStatus } });

    log.info("telemetry");

    expect(setStatus).toHaveBeenCalledWith("pi-image-fit", "telemetry");
    expect(notify).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("info falls back to notify when the host has no setStatus", () => {
    const notify = vi.fn();
    log.useUiSink({ hasUI: true, ui: { notify } });
    log.info("telemetry");
    expect(notify).toHaveBeenCalledWith("telemetry", "info");
  });

  it("warnings stay notifications", () => {
    const notify = vi.fn();
    const setStatus = vi.fn();
    log.useUiSink({ hasUI: true, ui: { notify, setStatus } });
    log.warn("trouble");
    expect(notify).toHaveBeenCalledWith("trouble", "warning");
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("a stale context keeps the previous channel", () => {
    const notify = vi.fn();
    log.useUiSink({ hasUI: true, ui: { notify } });
    const stale = makeCtx({ hasUI: true, notify: vi.fn() });
    stale.invalidate();
    expect(() => log.useUiSink(stale.ctx)).not.toThrow();
    log.warn("trouble");
    expect(notify).toHaveBeenCalledWith("trouble", "warning");
  });

  it("accepts 'on' for PI_IMAGE_FIT_QUIET like the other boolean vars", () => {
    process.env.PI_IMAGE_FIT_QUIET = "On";
    log.info("telemetry");
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("log sink — load-time buffering", () => {
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

  it("holds messages until the first context, then delivers them in order via its UI", () => {
    log.deferUntilContext();
    log.warn("bad env");
    log.info("loaded");
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    const notify = vi.fn();
    const setStatus = vi.fn();
    log.useUiSink({ hasUI: true, ui: { notify, setStatus } });

    expect(notify).toHaveBeenCalledWith("bad env", "warning");
    expect(setStatus).toHaveBeenCalledWith("pi-image-fit", "loaded");
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("flushes to console when the first context has no UI", () => {
    log.deferUntilContext();
    log.warn("bad env");
    log.useUiSink({ hasUI: false, ui: { notify: () => {} } });
    expect(warnSpy).toHaveBeenCalledWith("bad env");
  });

  it("flushes once; later messages are delivered immediately", () => {
    log.deferUntilContext();
    log.useUiSink({});
    log.useUiSink({});
    log.info("later");
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps only the newest 50 held messages", () => {
    log.deferUntilContext();
    for (let i = 0; i < 60; i++) log.info(`m${i}`);
    log.useUiSink({});
    expect(logSpy).toHaveBeenCalledTimes(50);
    expect(logSpy.mock.calls[0][0]).toBe("m10");
    expect(logSpy.mock.calls[49][0]).toBe("m59");
  });

  it("drops held messages in quiet mode", () => {
    log.deferUntilContext();
    log.info("loaded");
    process.env.PI_IMAGE_FIT_QUIET = "1";
    log.useUiSink({});
    expect(logSpy).not.toHaveBeenCalled();
    delete process.env.PI_IMAGE_FIT_QUIET;
  });
});
