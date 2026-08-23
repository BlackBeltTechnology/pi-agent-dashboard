/**
 * What survives of the container-selection tests.
 *
 * An earlier draft of this change injected a dialog container INTO the slot so
 * it could wrap a `presentation: "dialog"` claim per-claim. That seam was
 * removed: the overlay's underlay must cover the viewport, so the host has to
 * lift a dialog claim out of the content region entirely — which the slot
 * cannot do from the inside. `presentation` is now consumed by the host via
 * `useShellOverlayRoutePresentation` (see `shell-overlay-presentation-hook.test.tsx`),
 * and the slot renders the claim body only.
 *
 * These keep the LAYOUT contract the removed tests also covered: whatever the
 * host wraps it in, the slot supplies the flex height wrapper the claim body
 * needs, or a full-height plugin surface collapses.
 *
 * See change: add-route-backed-overlay-dialogs (design D2a).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  type ClaimEntry,
  createSlotRegistry,
  PluginContextProvider,
  ShellOverlayRouteSlot,
} from "../index.js";

// This package's vitest project does not enable testing-library's automatic
// cleanup, so renders would otherwise accumulate across tests and every query
// after the first would fail with "Found multiple elements".
afterEach(cleanup);

function overlayClaim(presentation?: "page" | "dialog"): ClaimEntry {
  return {
    pluginId: "test-plugin",
    slot: "shell-overlay-route",
    path: "/test-overlay",
    ...(presentation ? { presentation } : {}),
    Component: () => <div data-testid="claim-content">claim content</div>,
  } as unknown as ClaimEntry;
}

function setup(claim: ClaimEntry) {
  const onBack = vi.fn();
  const registry = createSlotRegistry();
  registry.addClaim(claim);
  const { hook } = memoryLocation({ path: "/test-overlay" });
  const utils = render(
    <Router hook={hook}>
      <PluginContextProvider registry={registry}>
        <ShellOverlayRouteSlot onBack={onBack} registry={registry} />
      </PluginContextProvider>
    </Router>,
  );
  return { ...utils, onBack };
}

describe("ShellOverlayRouteSlot — claim body and layout", () => {
  it.each([
    ["an undeclared presentation", undefined],
    ["presentation:'dialog'", "dialog" as const],
    ["presentation:'page'", "page" as const],
  ])("renders the matched claim body for %s", (_label, presentation) => {
    setup(overlayClaim(presentation));
    expect(screen.getByTestId("claim-content")).toBeTruthy();
  });

  it("keeps the flex height wrapper around the claim body", () => {
    const { container } = setup(overlayClaim());
    // Without this a full-height plugin surface collapses to content height.
    const wrapper = container.querySelector(".flex-1.min-h-0.relative");
    expect(wrapper).toBeTruthy();
    expect(wrapper?.querySelector("[data-testid='claim-content']")).toBeTruthy();
  });

  it("does not wrap the body in any dialog chrome of its own", () => {
    // The HOST owns the dialog; a slot-level dialog would double-wrap and, worse,
    // position the underlay inside the content region.
    const { container } = setup(overlayClaim("dialog"));
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });
});
