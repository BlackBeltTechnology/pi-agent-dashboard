/**
 * `useShellOverlayRoutePresentation` — the synchronous answer `App.tsx` needs in
 * its body to choose the mobile layout (D3a, task 4.3).
 *
 * See change: add-route-backed-overlay-dialogs.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  type ClaimEntry,
  createSlotRegistry,
  PluginContextProvider,
  useShellOverlayRoutePresentation,
} from "../index.js";

afterEach(cleanup);

function claim(path: string, presentation?: "page" | "dialog"): ClaimEntry {
  return {
    pluginId: "p",
    slot: "shell-overlay-route",
    path,
    ...(presentation ? { presentation } : {}),
    Component: () => null,
  } as unknown as ClaimEntry;
}

function presentationAt(location: string, claims: ClaimEntry[]) {
  let result: "page" | "dialog" | null = null;
  const registry = createSlotRegistry();
  for (const c of claims) registry.addClaim(c);
  const { hook } = memoryLocation({ path: location });
  function Probe() {
    result = useShellOverlayRoutePresentation(registry);
    return null;
  }
  render(
    <Router hook={hook}>
      <PluginContextProvider registry={registry}>
        <Probe />
      </PluginContextProvider>
    </Router>,
  );
  return result;
}

describe("useShellOverlayRoutePresentation", () => {
  it("returns null when no claim matches", () => {
    expect(presentationAt("/elsewhere", [claim("/board")])).toBeNull();
  });

  it("defaults a matched claim with no declared presentation to dialog", () => {
    expect(presentationAt("/board", [claim("/board")])).toBe("dialog");
  });

  it("returns 'page' for a claim that opted out", () => {
    expect(presentationAt("/board", [claim("/board", "page")])).toBe("page");
  });

  it("reads the presentation of the MATCHED claim, not the first claim", () => {
    // Non-vacuous ordering check: a hook that returned claims[0] would answer
    // "page" here and put a dialog claim in the wrong mobile layout.
    const result = presentationAt("/second", [claim("/first", "page"), claim("/second", "dialog")]);
    expect(result).toBe("dialog");
  });

  it("resolves :param patterns", () => {
    expect(presentationAt("/folder/Zm9v/goals", [claim("/folder/:cwd/goals", "page")])).toBe("page");
  });
});
