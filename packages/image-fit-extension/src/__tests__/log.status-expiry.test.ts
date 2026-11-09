/**
 * The footer status must not outlive what it reports.
 *
 * `info` goes to `ui.setStatus(STATUS_KEY, msg)`, and pi keeps a status until
 * its owner clears it. Nothing ever cleared this one, so the report of the
 * last resized image stayed pinned under the stats line for the rest of the
 * session — long after the image it described had scrolled away. Users read a
 * stale line as "the extension is doing something right now" and reached for
 * PI_IMAGE_FIT_QUIET, which silences the diagnostics instead of unpinning them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as log from "../log.js";

/** A pi ctx with a real UI: both channels are spies, so the test reads what the footer and the notifications were told. */
function makeUiCtx() {
  const setStatus = vi.fn();
  const notify = vi.fn();
  return { ctx: { hasUI: true, ui: { notify, setStatus } }, setStatus, notify };
}

describe("log sink — footer status expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    log.resetUiSink();
    delete process.env.PI_IMAGE_FIT_QUIET;
  });

  afterEach(() => {
    log.resetUiSink();
    vi.useRealTimers();
  });

  it("#1 clears the status once the report has had its moment", () => {
    const { ctx, setStatus } = makeUiCtx();
    log.useUiSink(ctx);

    log.info("[pi-image-fit] a.png 3024×4032 5.1 MB → 1176×1568 420 KB");
    expect(setStatus).toHaveBeenCalledWith(log.STATUS_KEY, expect.stringContaining("a.png"));

    vi.advanceTimersByTime(log.STATUS_TTL_MS);
    expect(setStatus).toHaveBeenLastCalledWith(log.STATUS_KEY, undefined);
  });

  it("#2 keeps the newest report visible for its full window", () => {
    const { ctx, setStatus } = makeUiCtx();
    log.useUiSink(ctx);

    log.info("first");
    vi.advanceTimersByTime(log.STATUS_TTL_MS - 1);
    log.info("second");

    // The first message's deadline must not take the second one down with it.
    vi.advanceTimersByTime(1);
    expect(setStatus).toHaveBeenLastCalledWith(log.STATUS_KEY, "second");

    vi.advanceTimersByTime(log.STATUS_TTL_MS);
    expect(setStatus).toHaveBeenLastCalledWith(log.STATUS_KEY, undefined);
  });

  it("#3 does not hold the host process open", () => {
    const { ctx } = makeUiCtx();
    log.useUiSink(ctx);

    const unref = vi.fn();
    const setTimeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockReturnValue({ unref } as unknown as ReturnType<typeof setTimeout>);
    try {
      log.info("telemetry");
      expect(unref).toHaveBeenCalled(); // a print-mode run must still exit on its own
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("#4 warnings stay transient notifications, with no expiry timer", () => {
    const { ctx, setStatus, notify } = makeUiCtx();
    log.useUiSink(ctx);

    log.warn("[pi-image-fit] WARN resize failed; passing through original");
    vi.advanceTimersByTime(log.STATUS_TTL_MS * 2);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("WARN"), "warning");
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("#6 clears through the channel current at expiry, not the one captured at arm time", () => {
    // pi swaps ctx on reload / newSession / fork, and a stale ctx throws from
    // its getters. Clearing through the captured channel would throw and leave
    // the status pinned in the footer that is actually on screen.
    const before = makeUiCtx();
    log.useUiSink(before.ctx);
    log.info("armed under the old ctx");

    const after = makeUiCtx();
    before.setStatus.mockImplementation(() => {
      throw new Error("stale extension context");
    });
    log.useUiSink(after.ctx);

    vi.advanceTimersByTime(log.STATUS_TTL_MS);
    expect(after.setStatus).toHaveBeenCalledWith(log.STATUS_KEY, undefined);
  });

  it("#5 resetUiSink cancels a pending expiry instead of firing at a dead channel", () => {
    const { ctx, setStatus } = makeUiCtx();
    log.useUiSink(ctx);

    log.info("telemetry");
    setStatus.mockClear();
    log.resetUiSink();

    vi.advanceTimersByTime(log.STATUS_TTL_MS * 2);
    expect(setStatus).not.toHaveBeenCalled();
  });
});
