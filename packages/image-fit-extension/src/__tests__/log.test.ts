import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as log from "../log.js";

describe("log sink", () => {
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

  it("falls back to console when no host UI was offered", () => {
    log.info("telemetry");
    log.warn("trouble");
    expect(logSpy).toHaveBeenCalledWith("telemetry");
    expect(warnSpy).toHaveBeenCalledWith("trouble");
  });

  it("prefers the host UI channel once a context offers one", () => {
    const notify = vi.fn();
    log.useUiSink({ ui: { notify } });

    log.info("telemetry");
    log.warn("trouble");

    expect(notify).toHaveBeenNthCalledWith(1, "telemetry", "info");
    expect(notify).toHaveBeenNthCalledWith(2, "trouble", "warning");
    // Nothing reaches stdio, so a TUI prompt line stays clean.
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("ignores a context without a usable ui.notify", () => {
    log.useUiSink(undefined);
    log.useUiSink({});
    log.useUiSink({ ui: {} });
    log.useUiSink({ ui: { notify: "nope" } });

    log.info("telemetry");
    expect(logSpy).toHaveBeenCalledWith("telemetry");
  });

  it("keeps the first UI channel it was given", () => {
    const first = vi.fn();
    const second = vi.fn();
    log.useUiSink({ ui: { notify: first } });
    log.useUiSink({ ui: { notify: second } });

    log.info("telemetry");

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("falls back to console when the UI channel throws", () => {
    log.useUiSink({
      ui: {
        notify: () => {
          throw new Error("ui gone");
        },
      },
    });

    log.warn("trouble");

    expect(warnSpy).toHaveBeenCalledWith("trouble");
  });

  it("drops everything when PI_IMAGE_FIT_QUIET is truthy", () => {
    const notify = vi.fn();
    log.useUiSink({ ui: { notify } });
    for (const value of ["1", "true", "YES"]) {
      process.env.PI_IMAGE_FIT_QUIET = value;
      log.info("telemetry");
      log.warn("trouble");
    }

    expect(notify).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("treats a non-truthy PI_IMAGE_FIT_QUIET as unset", () => {
    process.env.PI_IMAGE_FIT_QUIET = "0";
    log.info("telemetry");
    expect(logSpy).toHaveBeenCalledWith("telemetry");
  });
});
