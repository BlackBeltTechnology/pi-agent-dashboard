/**
 * `ShellOverlayRouteSlot` container selection (design D2 + D2a).
 *
 * The claim's effective `presentation` decides the container. The dialog
 * container is INJECTED by the host rather than imported, because
 * `client-utils` (where `Dialog` lives) already depends on this package —
 * importing it back would be a cycle. See D2a.
 *
 * See change: add-route-backed-overlay-dialogs (tasks 4.1-4.3).
 */
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  type ClaimEntry,
  createSlotRegistry,
  type OverlayContainerProps,
  PluginContextProvider,
  ShellOverlayRouteSlot,
} from "../index.js";

const HEIGHT_WRAPPER = ".flex-1.min-h-0.relative";

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

/** Stand-in for the client's `RouteBackedOverlay`. */
function FakeDialogContainer({ children, onDismiss }: OverlayContainerProps) {
  return (
    <div data-testid="dialog-container">
      <button type="button" data-testid="dismiss" onClick={onDismiss}>
        x
      </button>
      {children}
    </div>
  );
}

function setup(
  claim: ClaimEntry,
  opts: { container?: React.ComponentType<OverlayContainerProps> } = {},
) {
  const onBack = vi.fn();
  const registry = createSlotRegistry();
  registry.addClaim(claim);
  const { hook } = memoryLocation({ path: "/test-overlay" });
  const utils = render(
    <Router hook={hook}>
      <PluginContextProvider registry={registry}>
        <ShellOverlayRouteSlot
          onBack={onBack}
          registry={registry}
          dialogContainer={opts.container}
        />
      </PluginContextProvider>
    </Router>,
  );
  return { ...utils, onBack };
}

describe("ShellOverlayRouteSlot — container selection", () => {
  it("renders presentation:'page' in the page wrapper, not the dialog", () => {
    setup(overlayClaim("page"), { container: FakeDialogContainer });
    expect(screen.getByTestId("claim-content")).toBeTruthy();
    expect(screen.queryByTestId("dialog-container")).toBeNull();
  });

  it("defaults an undeclared presentation to the dialog container", () => {
    // D3: the default is "dialog". This is the assertion that actually
    // converts Automation, Goals, KB and the subagent popout.
    setup(overlayClaim(), { container: FakeDialogContainer });
    expect(screen.getByTestId("dialog-container")).toBeTruthy();
    expect(screen.getByTestId("claim-content")).toBeTruthy();
  });

  it("renders an explicit presentation:'dialog' in the dialog container", () => {
    setup(overlayClaim("dialog"), { container: FakeDialogContainer });
    expect(screen.getByTestId("dialog-container")).toBeTruthy();
  });

  it("falls back to the page wrapper when no container is injected", () => {
    // A host that has not opted in (or a test harness) must keep working
    // exactly as it does today rather than crashing on a missing container.
    setup(overlayClaim("dialog"));
    expect(screen.getByTestId("claim-content")).toBeTruthy();
  });

  it("routes the container's dismissal to onBack", () => {
    const { onBack } = setup(overlayClaim(), { container: FakeDialogContainer });
    screen.getByTestId("dismiss").click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("ShellOverlayRouteSlot — height propagation (4.2)", () => {
  it("keeps the height wrapper for the page container", () => {
    const { container } = setup(overlayClaim("page"), { container: FakeDialogContainer });
    expect(container.querySelector(HEIGHT_WRAPPER)).toBeTruthy();
  });

  it("keeps the height wrapper INSIDE the dialog container", () => {
    // The wrapper contract is preserved for both containers, so a claim that
    // sizes itself against a flex parent renders identically in either.
    const { container } = setup(overlayClaim(), { container: FakeDialogContainer });
    const dialog = container.querySelector("[data-testid='dialog-container']");
    expect(dialog?.querySelector(HEIGHT_WRAPPER)).toBeTruthy();
  });
});
