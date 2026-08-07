import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installUnhandledRejectionReporter,
  logRejection,
  reportError,
} from "../report-error.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reportError — the client's logging path (test-plan #X4)", () => {
  it("X4: forwards the rejection reason to the console-error path exactly once", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reason = new Error("boom");

    reportError(reason, "useThing");

    expect(spy).toHaveBeenCalledTimes(1);
    const args = spy.mock.calls[0];
    expect(args).toContain(reason);
    expect(String(args[0])).toContain("useThing");
  });

  it("X4: works without a context label", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reason = new Error("no-context");

    reportError(reason);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toContain(reason);
  });
});

describe("logRejection — the per-site discard handler (test-plan #X4)", () => {
  it("X4: names its site and forwards the reason, never swallowing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reason = new Error("site-failure");

    await Promise.reject(reason).catch(logRejection("Widget.load"));

    expect(spy).toHaveBeenCalledTimes(1);
    const args = spy.mock.calls[0];
    expect(args).toContain(reason);
    expect(String(args[0])).toContain("Widget.load");
  });
});

describe("global unhandled-rejection handler does not swallow (test-plan #X3)", () => {
  it("X3: the emitted record carries the original message and stack, not a placeholder", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const target = new EventTarget();
    const uninstall = installUnhandledRejectionReporter(target);

    const reason = new Error("distinctive-failure-42");
    const event = new Event("unhandledrejection") as Event & { reason: unknown };
    event.reason = reason;
    target.dispatchEvent(event);

    expect(spy).toHaveBeenCalledTimes(1);
    const args = spy.mock.calls[0];
    // The reason object itself is forwarded — not stringified into a placeholder,
    // so the console record retains message + stack.
    expect(args).toContain(reason);
    expect(reason.stack).toBeTruthy();
    const flat = args.map((a) => String(a)).join(" ");
    expect(flat).toContain("distinctive-failure-42");

    uninstall();
  });

  it("X3: observes without preventing default — it is a net, not a sink", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const target = new EventTarget();
    const uninstall = installUnhandledRejectionReporter(target);

    const event = new Event("unhandledrejection", { cancelable: true }) as Event & {
      reason: unknown;
    };
    event.reason = new Error("still-visible");
    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);

    uninstall();
  });

  it("X3: uninstall removes the listener (no double-reporting on re-install)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const target = new EventTarget();
    const uninstall = installUnhandledRejectionReporter(target);
    uninstall();

    const event = new Event("unhandledrejection") as Event & { reason: unknown };
    event.reason = new Error("after-uninstall");
    target.dispatchEvent(event);

    expect(spy).not.toHaveBeenCalled();
  });
});
