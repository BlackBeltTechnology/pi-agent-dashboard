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
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  PluginContextProvider,
  createSlotRegistry,
  useShellOverlayRouteMatched,
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
