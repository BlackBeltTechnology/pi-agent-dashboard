/**
 * Route-backed overlay renderer — the D1 (option C) container.
 *
 * The load-bearing assertion here is that the underlay renders from the FROZEN
 * background location, not from `window.location`. Everything else (focus trap,
 * Escape, backdrop) is already owned by the shared `Dialog`; these tests pin the
 * wiring, not a reimplementation of it.
 *
 * See change: add-route-backed-overlay-dialogs (test-plan S-07, S-08, S-08b).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, useSearch } from "wouter";
import { RouteBackedOverlay } from "../RouteBackedOverlay.js";

/**
 * Point `window.location` at the overlay's own route.
 *
 * Without this the underlay assertions are VACUOUS: jsdom's default location is
 * "/", so a settings branch would fail to match whether or not the underlay is
 * pinned. The leak these tests exist to catch only appears when the live
 * location actually matches something in the background subtree.
 */
function setBrowserLocation(url: string) {
  window.history.replaceState(null, "", url);
}

afterEach(() => {
  setBrowserLocation("/");
});

/** A background subtree that reports which route it matched, and its search. */
function BackgroundProbe() {
  const search = useSearch();
  return (
    <>
      <div data-testid="bg-search">{search}</div>
      <Route path="/session/:id">
        {(params) => <div data-testid="bg-session">session:{params.id}</div>}
      </Route>
      <Route path="/folder/:cwd/view">
        {() => <div data-testid="bg-folder-view">folder-view</div>}
      </Route>
      <Route path="/settings/:page">
        {() => <div data-testid="bg-settings">settings-LEAKED</div>}
      </Route>
    </>
  );
}

function renderOverlay(overrides: Partial<Parameters<typeof RouteBackedOverlay>[0]> = {}) {
  const onDismiss = vi.fn();
  const utils = render(
    <RouteBackedOverlay
      background={{ path: "/session/abc", search: "" }}
      backgroundContent={<BackgroundProbe />}
      onDismiss={onDismiss}
      testId="route-overlay"
      {...overrides}
    >
      <div data-testid="overlay-body">overlay content</div>
    </RouteBackedOverlay>,
  );
  return { ...utils, onDismiss };
}

describe("RouteBackedOverlay — overlay surface", () => {
  it("renders its children inside a dialog", () => {
    renderOverlay();
    expect(screen.getByTestId("overlay-body")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("RouteBackedOverlay — pinned underlay", () => {
  it("renders the background subtree from the frozen path", () => {
    setBrowserLocation("/settings/general");
    renderOverlay();
    expect(screen.getByTestId("bg-session").textContent).toBe("session:abc");
  });

  it("does NOT let the overlay's own route match in the underlay", () => {
    // Non-vacuous: the live location DOES match /settings/:page, so an unpinned
    // underlay would render the settings branch here.
    setBrowserLocation("/settings/general");
    renderOverlay();
    expect(screen.queryByTestId("bg-settings")).toBeNull();
    expect(screen.getByTestId("bg-session")).toBeTruthy();
  });

  it("pins the search half, not just the path", () => {
    // Non-vacuous: the live location carries a DIFFERENT query. Reading the
    // search from window.location would surface `path=/live/leak.ts` here.
    setBrowserLocation("/settings/general?path=/live/leak.ts");
    renderOverlay({
      background: { path: "/folder/xyz/view", search: "path=/frozen.ts" },
    });
    expect(screen.getByTestId("bg-folder-view")).toBeTruthy();
    expect(screen.getByTestId("bg-search").textContent).toBe("path=/frozen.ts");
  });

  it("marks the underlay aria-hidden and inert", () => {
    const { container } = renderOverlay();
    const underlay = container.querySelector("[data-testid='route-overlay-underlay']");
    expect(underlay).toBeTruthy();
    expect(underlay?.getAttribute("aria-hidden")).toBe("true");
    expect(underlay?.hasAttribute("inert")).toBe(true);
  });

  it("keeps the underlay out of the accessibility tree entirely", () => {
    renderOverlay();
    // getByTestId still finds it in the DOM, but it must not be exposed as
    // content: the dialog is aria-modal and the underlay is aria-hidden.
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });
});

describe("RouteBackedOverlay — dismissal", () => {
  it("dismisses on Escape", () => {
    const { onDismiss } = renderOverlay();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses on backdrop click", () => {
    const { onDismiss } = renderOverlay();
    fireEvent.click(screen.getByTestId("route-overlay-overlay"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss on a click inside the surface", () => {
    const { onDismiss } = renderOverlay();
    fireEvent.click(screen.getByTestId("overlay-body"));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
