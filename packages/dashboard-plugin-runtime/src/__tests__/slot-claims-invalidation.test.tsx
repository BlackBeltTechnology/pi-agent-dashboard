/**
 * L1 — slot-claims invalidation store (tasks 2.3; test-plan F2, F3).
 *
 * Contract (dashboard-plugin-loader delta):
 * - `bumpSlotClaimsVersion()` re-evaluates every mounted gate wrapper —
 *   `useSlotHasClaimsForSession` re-invokes `shouldRender` — with NO session
 *   broadcast, including for idle sessions that will never emit
 *   `session_updated`.
 * - an UNBUMPED store changes nothing: without a bump, `shouldRender` is not
 *   re-invoked and gate behaviour is identical to the pre-change behaviour.
 * - `shouldRender` stays synchronous (no async gate path is introduced).
 *
 * See change: add-blackhole-session-pipeline.
 */
import { act, render } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { PluginContextProvider } from "../plugin-context.js";
import {
  __resetSlotClaimsVersionForTests,
  bumpSlotClaimsVersion,
  getSlotClaimsVersion,
} from "../slot-claims-invalidation.js";
import { useSlotHasClaimsForSession } from "../slot-consumers.js";
import { createSlotRegistry } from "../slot-registry.js";

const session = { id: "019fe770-a0a4-70bb-ac85-2e92e6aa8216" } as DashboardSession;

/** Mount a probe that reports `useSlotHasClaimsForSession` for session-card-memory. */
function mountGate(shouldRender: () => boolean, onRender?: () => void) {
  const registry = createSlotRegistry();
  registry.addClaim({
    pluginId: "blackhole",
    priority: 100,
    slot: "session-card-memory",
    shouldRender: () => shouldRender(),
  });
  let latest: boolean | null = null;
  function Probe() {
    onRender?.();
    latest = useSlotHasClaimsForSession("session-card-memory", session);
    return null;
  }
  render(
    <PluginContextProvider registry={registry}>
      <Probe />
    </PluginContextProvider>,
  );
  return { get: () => latest! };
}

describe("slot-claims invalidation store", () => {
  it("starts at version 0 and bumps monotonically", () => {
    __resetSlotClaimsVersionForTests();
    expect(getSlotClaimsVersion()).toBe(0);
    bumpSlotClaimsVersion();
    expect(getSlotClaimsVersion()).toBe(1);
    bumpSlotClaimsVersion();
    expect(getSlotClaimsVersion()).toBe(2);
    __resetSlotClaimsVersionForTests();
  });

  it("a bump re-invokes shouldRender on a mounted wrapper with no session broadcast (F2)", () => {
    __resetSlotClaimsVersionForTests();
    let installed = false;
    const gate = mountGate(() => installed);
    expect(gate.get()).toBe(false);

    // The gate's module signal resolves AFTER mount (late-arriving boot check).
    act(() => {
      installed = true;
      bumpSlotClaimsVersion();
    });
    expect(gate.get()).toBe(true);
    __resetSlotClaimsVersionForTests();
  });

  it("an unbumped store re-invokes nothing — shouldRender call count unchanged (F3)", () => {
    __resetSlotClaimsVersionForTests();
    const shouldRender = vi.fn(() => true);
    const onRender = vi.fn();
    mountGate(shouldRender, onRender);
    const callsAfterMount = shouldRender.mock.calls.length;
    const rendersAfterMount = onRender.mock.calls.length;

    // No bump: nothing re-renders the wrapper.
    expect(getSlotClaimsVersion()).toBe(0);
    expect(shouldRender.mock.calls.length).toBe(callsAfterMount);
    expect(onRender.mock.calls.length).toBe(rendersAfterMount);
    __resetSlotClaimsVersionForTests();
  });

  it("a bump with an unchanged signal still re-evaluates gates synchronously", () => {
    __resetSlotClaimsVersionForTests();
    const shouldRender = vi.fn(() => false);
    const gate = mountGate(shouldRender);
    const before = shouldRender.mock.calls.length;
    act(() => {
      bumpSlotClaimsVersion();
    });
    expect(shouldRender.mock.calls.length).toBeGreaterThan(before);
    expect(gate.get()).toBe(false);
    __resetSlotClaimsVersionForTests();
  });
});
