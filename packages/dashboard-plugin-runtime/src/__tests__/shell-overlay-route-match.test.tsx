/**
 * Regression test for `useShellOverlayRouteMatched` — verifies the
 * internal path matcher handles the actual production URL shapes
 * (URL-encoded segments, multiple :param tokens, etc.).
 *
 * See change: fix-flows-plugin-polish (path-as-first-class-claim-field).
 */
import { describe, it, expect } from "vitest";

// Re-import the matcher via a public hook surface would be cleanest, but
// the matcher is currently a file-private function. Test it indirectly
// by registering a claim and exercising the hook through render.

import React from "react";
import { render } from "@testing-library/react";
import { Router, useRoute } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  PluginContextProvider,
  ShellOverlayRouteSlot,
  createSlotRegistry,
  useShellOverlayRouteMatched,
  useShellOverlayRoutePresentation,
  type ClaimEntry,
} from "../index.js";

function Probe({ onResult }: { onResult: (matched: boolean) => void }) {
  const matched = useShellOverlayRouteMatched();
  onResult(matched);
  return null;
}

function setupWithLocation(
  initialPath: string,
  claims: ClaimEntry[],
): { matched: boolean } {
  const result = { matched: false };
  const { hook } = memoryLocation({ path: initialPath });
  const registry = createSlotRegistry();
  for (const c of claims) registry.addClaim(c);
  render(
    <Router hook={hook}>
      <PluginContextProvider registry={registry}>
        <Probe onResult={(m) => (result.matched = m)} />
      </PluginContextProvider>
    </Router>,
  );
  return result;
}

/**
 * Same as `setupWithLocation` but renders the probe OUTSIDE the
 * PluginContextProvider, passing the registry explicitly. Mirrors the
 * shell's call site in `packages/client/src/App.tsx` where
 * `useShellOverlayRouteMatched(_pluginRegistry)` is called from App's
 * body before the provider is mounted in the JSX tree.
 *
 * See change: fix-flows-plugin-polish (hook-outside-provider fix).
 */
function setupOutsideProvider(
  initialPath: string,
  claims: ClaimEntry[],
): { matched: boolean } {
  const result = { matched: false };
  const { hook } = memoryLocation({ path: initialPath });
  const registry = createSlotRegistry();
  for (const c of claims) registry.addClaim(c);
  function ProbeWithRegistry() {
    const matched = useShellOverlayRouteMatched(registry);
    result.matched = matched;
    return null;
  }
  render(
    <Router hook={hook}>
      <ProbeWithRegistry />
    </Router>,
  );
  return result;
}

describe("useShellOverlayRouteMatched", () => {
  const FlowAgentPopoutClaim: React.FC = () => null;
  const SubagentPopoutClaim: React.FC = () => null;

  const flowAgentClaim: ClaimEntry = {
    pluginId: "flows",
    priority: 100,
    slot: "shell-overlay-route",
    path: "/session/:sid/flow/:flowId/agent/:agentId",
    sessionParam: "sid",
    Component: FlowAgentPopoutClaim,
  };

  const subagentClaim: ClaimEntry = {
    pluginId: "subagents",
    priority: 100,
    slot: "shell-overlay-route",
    path: "/session/:sessionId/subagent/:agentId",
    sessionParam: "sessionId",
    Component: SubagentPopoutClaim,
  };

  it("matches the production flow-agent popout URL with URL-encoded flow id", () => {
    const result = setupWithLocation(
      "/session/019e47a4-654a-7426-8a34-6091048aac0d/flow/custom%3Atest/agent/research",
      [flowAgentClaim],
    );
    expect(result.matched).toBe(true);
  });

  it("matches plain (non-encoded) flow-agent popout URL", () => {
    const result = setupWithLocation(
      "/session/sess_1/flow/my-pipe/agent/agent_3",
      [flowAgentClaim],
    );
    expect(result.matched).toBe(true);
  });

  it("matches subagent popout URL", () => {
    const result = setupWithLocation(
      "/session/sess_1/subagent/agent_x",
      [subagentClaim],
    );
    expect(result.matched).toBe(true);
  });

  it("does NOT match unrelated URLs", () => {
    const result = setupWithLocation("/", [flowAgentClaim, subagentClaim]);
    expect(result.matched).toBe(false);
  });

  it("does NOT match similar-but-different URLs", () => {
    // Wrong segment count
    const r1 = setupWithLocation("/session/sess_1", [flowAgentClaim]);
    expect(r1.matched).toBe(false);
    // Wrong literal in middle
    const r2 = setupWithLocation(
      "/session/sess_1/notflow/x/agent/y",
      [flowAgentClaim],
    );
    expect(r2.matched).toBe(false);
  });

  it("falls back to legacy claim.config.path when top-level path absent", () => {
    const legacyClaim: ClaimEntry = {
      pluginId: "legacy",
      priority: 100,
      slot: "shell-overlay-route",
      config: { path: "/legacy/:id" },
      Component: () => null,
    };
    const result = setupWithLocation("/legacy/abc", [legacyClaim]);
    expect(result.matched).toBe(true);
  });

  it("returns false when no shell-overlay-route claims registered", () => {
    const result = setupWithLocation(
      "/session/sess_1/flow/my-pipe/agent/agent_3",
      [],
    );
    expect(result.matched).toBe(false);
  });

  it("matches when called OUTSIDE PluginContextProvider with explicit registry", () => {
    // Regression: the hook is called from App's body before its own
    // PluginContextProvider is mounted in the JSX tree. Passing the
    // registry explicitly bypasses the missing context.
    // See change: fix-flows-plugin-polish (hook-outside-provider fix).
    const result = setupOutsideProvider(
      "/session/sess_1/subagent/agent_x",
      [subagentClaim],
    );
    expect(result.matched).toBe(true);
  });

  it("returns false outside provider with explicit registry when no claim matches", () => {
    const result = setupOutsideProvider("/", [subagentClaim]);
    expect(result.matched).toBe(false);
  });
});

// ── trailing optional wildcard `/*?` — see change: add-plugin-app-host ──────

interface MechanismResult {
  matched: boolean;
  presentation: string | null;
  /** params the slot component received on its FIRST render (sync path), or null when not rendered. */
  slotParams: Record<string, string> | null;
  /** wouter `useRoute` probe on the same pattern, with an absent `*` normalised to "". */
  probe: { matched: boolean; star: string | null };
}

function allMechanisms(location: string, pattern: string, claims?: ClaimEntry[]): MechanismResult {
  const out: MechanismResult = { matched: false, presentation: null, slotParams: null, probe: { matched: false, star: null } };
  const SlotComp = ({ params }: { params: Record<string, string> }) => {
    if (out.slotParams === null) out.slotParams = { ...params };
    return null;
  };
  const registry = createSlotRegistry();
  const list = claims ?? [
    {
      pluginId: "wall",
      priority: 100,
      slot: "shell-overlay-route",
      path: pattern,
      depth: 2,
      parentPath: "/folder/:e",
      presentation: "content",
      Component: SlotComp as unknown as React.ComponentType<Record<string, unknown>>,
    } as ClaimEntry,
  ];
  for (const c of list) registry.addClaim(c);
  const { hook } = memoryLocation({ path: location });
  function Hooks() {
    out.matched = useShellOverlayRouteMatched(registry);
    out.presentation = useShellOverlayRoutePresentation(registry);
    const [m, params] = useRoute(pattern);
    const star = m ? ((params as Record<string, string | undefined>)["*"] ?? "") : null;
    out.probe = { matched: m, star };
    return null;
  }
  render(
    <Router hook={hook}>
      <PluginContextProvider registry={registry}>
        <Hooks />
        <ShellOverlayRouteSlot onBack={() => {}} registry={registry} />
      </PluginContextProvider>
    </Router>,
  );
  return out;
}

describe("shared matcher — trailing /*? wildcard (test-plan #E6)", () => {
  const pattern = "/folder/:e/wall/*?";
  const cases: Array<[string, string | null]> = [
    ["/folder/x/wall", ""],
    ["/folder/x/wall/", ""],
    ["/folder/x/wall/graph/node-1", "graph/node-1"],
    ["/folder/x/walls", null],
    ["/folder/x", null],
  ];
  for (const [url, star] of cases) {
    it(`${url} → ${star === null ? "no match" : `params["*"] = ${JSON.stringify(star)}`}; all mechanisms agree`, () => {
      const r = allMechanisms(url, pattern);
      const expectMatch = star !== null;
      expect(r.matched).toBe(expectMatch);
      expect(r.presentation).toBe(expectMatch ? "content" : null);
      expect(r.probe.matched).toBe(expectMatch);
      if (expectMatch) {
        expect(r.slotParams).not.toBeNull();
        expect(r.slotParams!["*"]).toBe(star);
        expect(r.slotParams!.e).toBe("x");
        expect(r.probe.star).toBe(star);
      } else {
        expect(r.slotParams).toBeNull();
        expect(r.probe.star).toBeNull();
      }
    });
  }
});

describe("plugin disabled — claim absent falls through (test-plan #X4)", () => {
  it("matched=false and presentation=null when the demo claim is not registered", () => {
    const other: ClaimEntry = {
      pluginId: "other",
      priority: 100,
      slot: "shell-overlay-route",
      path: "/folder/:e/goals",
      Component: () => null,
    };
    const r = allMechanisms("/folder/x/demo-app", "/folder/:e/demo-app/*?", [other]);
    expect(r.matched).toBe(false);
    expect(r.presentation).toBeNull();
    expect(r.slotParams).toBeNull();
  });
});
