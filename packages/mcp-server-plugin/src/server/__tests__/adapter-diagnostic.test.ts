/**
 * Lazy adapter-version diagnostic (change extract-mcp-client-plugin, task 6.1):
 * the consumed service's verdict passes through, an absent service reads as
 * `unknown`, and the warning fires at most once on invocation — never at
 * construction (registration).
 */
import {
  ADAPTER_VERSION_FLOOR,
  type AdapterVerdict,
} from "@blackbelt-technology/pi-dashboard-mcp-client-plugin/core";
import { describe, expect, it, vi } from "vitest";
import { adapterVerdictOf, createAdapterWarnOnce } from "../adapter-diagnostic.js";

const svc = (verdict: AdapterVerdict) => ({ adapterVerdict: () => verdict });

describe("adapterVerdictOf", () => {
  it("passes through the consumed service's verdict", () => {
    const v: AdapterVerdict = {
      kind: "below-floor",
      installed: "2.19.0",
      floor: ADAPTER_VERSION_FLOOR,
      message: "too old",
    };
    expect(adapterVerdictOf(svc(v))).toBe(v);
  });

  it("an absent service reads as `unknown` with the floor", () => {
    expect(adapterVerdictOf(undefined)).toEqual({ kind: "unknown", floor: ADAPTER_VERSION_FLOOR });
  });
});

describe("createAdapterWarnOnce", () => {
  it("warns exactly once across many requests", () => {
    const warn = vi.fn();
    const fn = createAdapterWarnOnce({ warn }, () =>
      svc({ kind: "below-floor", installed: "2.19.0", floor: ADAPTER_VERSION_FLOOR, message: "upgrade now" }),
    );
    fn();
    fn();
    fn();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("upgrade now");
  });

  it("emits nothing at construction — the warning belongs to first use", () => {
    const warn = vi.fn();
    createAdapterWarnOnce({ warn }, () =>
      svc({ kind: "absent", floor: ADAPTER_VERSION_FLOOR, message: "no adapter" }),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("an `ok` verdict never warns", () => {
    const warn = vi.fn();
    const fn = createAdapterWarnOnce({ warn }, () =>
      svc({ kind: "ok", installed: "2.20.0", floor: ADAPTER_VERSION_FLOOR }),
    );
    fn();
    expect(warn).not.toHaveBeenCalled();
  });

  it("an absent service warns once with the `unknown` diagnostic", () => {
    const warn = vi.fn();
    const fn = createAdapterWarnOnce({ warn }, () => undefined);
    fn();
    fn();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("unknown");
  });
});
