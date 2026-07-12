import { describe, expect, it } from "vitest";
import { probeAll, PEER_AM, PEER_AM_LEGACY, PEER_AM_NAMES, PEER_FLOWS } from "../peer-probe.js";

function makeResolver(present: Set<string>): (spec: string) => string {
  return (spec) => {
    if (present.has(spec)) return `/fake/path/${spec}`;
    throw new Error(`Cannot find module '${spec}'`);
  };
}

describe("probeAll", () => {
  it("reports both peers ok when both resolve", () => {
    const r = probeAll({
      resolve: makeResolver(new Set([PEER_AM, PEER_FLOWS])),
    });
    expect(r.am.ok).toBe(true);
    expect(r.flows.ok).toBe(true);
    expect(r.bothPresent).toBe(true);
  });

  it("reports am missing when only flows resolves", () => {
    const r = probeAll({
      resolve: makeResolver(new Set([PEER_FLOWS])),
    });
    expect(r.am.ok).toBe(false);
    expect(r.am.reason).toMatch(/Cannot find module/);
    expect(r.flows.ok).toBe(true);
    expect(r.bothPresent).toBe(false);
  });

  it("reports flows missing when only am resolves", () => {
    const r = probeAll({
      resolve: makeResolver(new Set([PEER_AM])),
    });
    expect(r.am.ok).toBe(true);
    expect(r.flows.ok).toBe(false);
    expect(r.bothPresent).toBe(false);
  });

  it("falls back to event-listener count for pi-flows", () => {
    const r = probeAll({
      resolve: makeResolver(new Set([PEER_AM])),
      flowsListenerCount: () => 1,
    });
    expect(r.flows.ok).toBe(true);
    expect(r.bothPresent).toBe(true);
  });

  it("event-listener count of 0 does not save flows", () => {
    const r = probeAll({
      resolve: makeResolver(new Set([PEER_AM])),
      flowsListenerCount: () => 0,
    });
    expect(r.flows.ok).toBe(false);
    expect(r.bothPresent).toBe(false);
  });

  it("reports both missing when neither resolves", () => {
    const r = probeAll({
      resolve: makeResolver(new Set()),
    });
    expect(r.am.ok).toBe(false);
    expect(r.flows.ok).toBe(false);
    expect(r.bothPresent).toBe(false);
  });

  // ── tier-2 fallback (add-shared-pi-package-resolver) ────────────────

  it("tier-1 success stamps via:'node' and no entryPath", () => {
    const r = probeAll({
      resolve: makeResolver(new Set([PEER_AM, PEER_FLOWS])),
    });
    expect(r.am.via).toBe("node");
    expect(r.am.entryPath).toBeUndefined();
  });

  it("tier-1 miss + tier-2 hit returns via:'pi-packages' with entryPath", () => {
    const r = probeAll({
      resolve: makeResolver(new Set([PEER_FLOWS])), // AM missing from Node
      resolvePiPackage: (spec) =>
        spec === PEER_AM ? { entryPath: "/abs/path/to/am/entry.js" } : null,
    });
    expect(r.am.ok).toBe(true);
    expect(r.am.via).toBe("pi-packages");
    expect(r.am.entryPath).toBe("/abs/path/to/am/entry.js");
    expect(r.bothPresent).toBe(true);
  });

  it("tier-1 miss + tier-2 missing falls back to ok:false with tier-1 reason", () => {
    const r = probeAll({
      resolve: makeResolver(new Set([PEER_FLOWS])),
      // resolvePiPackage not provided
    });
    expect(r.am.ok).toBe(false);
    expect(r.am.via).toBeUndefined();
    expect(r.am.reason).toMatch(/Cannot find module/);
  });

  it("tier-1 miss + tier-2 returns null still reports miss", () => {
    const r = probeAll({
      resolve: makeResolver(new Set([PEER_FLOWS])),
      resolvePiPackage: () => null,
    });
    expect(r.am.ok).toBe(false);
    expect(r.am.via).toBeUndefined();
  });

  it("tier-2 hit on both peers — both via:'pi-packages'", () => {
    const r = probeAll({
      resolve: makeResolver(new Set()), // tier-1 misses everything
      resolvePiPackage: (spec) => ({ entryPath: `/abs/${spec}/entry.js` }),
    });
    expect(r.am.via).toBe("pi-packages");
    expect(r.flows.via).toBe("pi-packages");
    expect(r.bothPresent).toBe(true);
  });

  it("tier-2 returns empty entryPath string is treated as miss", () => {
    const r = probeAll({
      resolve: makeResolver(new Set()),
      resolvePiPackage: () => ({ entryPath: "" }),
    });
    expect(r.am.ok).toBe(false);
    expect(r.flows.ok).toBe(false);
  });

  // ── anthropic name-skew: scoped name probed BEFORE legacy ───────────
  // Regression guard: the peer was rescoped from @pi/anthropic-messages to
  // @blackbelt-technology/pi-anthropic-messages. A stale bridge probing only
  // the legacy name resolves nothing on npm. The shipped probe MUST try the
  // scoped name first and keep the legacy name as a fallback.

  it("probes the scoped name before the legacy name", () => {
    expect(PEER_AM).toBe("@blackbelt-technology/pi-anthropic-messages");
    expect(PEER_AM_LEGACY).toBe("@pi/anthropic-messages");
    expect(PEER_AM_NAMES).toEqual([PEER_AM, PEER_AM_LEGACY]);
    expect(PEER_AM_NAMES[0]).toBe(PEER_AM);
  });

  it("resolves when only the scoped name is present (legacy absent)", () => {
    const r = probeAll({
      resolve: makeResolver(new Set([PEER_AM, PEER_FLOWS])),
    });
    expect(r.am.ok).toBe(true);
    expect(r.am.via).toBe("node");
    expect(r.bothPresent).toBe(true);
  });

  it("resolves via legacy fallback when only the legacy name is present", () => {
    const r = probeAll({
      resolve: makeResolver(new Set([PEER_AM_LEGACY, PEER_FLOWS])),
    });
    expect(r.am.ok).toBe(true);
    expect(r.bothPresent).toBe(true);
  });

  it("neither scoped nor legacy resolvable surfaces the last probe reason", () => {
    const r = probeAll({
      resolve: makeResolver(new Set([PEER_FLOWS])),
    });
    expect(r.am.ok).toBe(false);
    expect(r.am.reason).toMatch(/Cannot find module/);
    // the reason names the LAST probed (legacy) spec
    expect(r.am.reason).toMatch(/@pi\/anthropic-messages/);
  });
});
