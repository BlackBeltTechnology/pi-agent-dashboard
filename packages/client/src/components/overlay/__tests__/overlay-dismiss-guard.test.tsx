/**
 * R1 — the highest-severity risk in this change.
 *
 * A route-backed overlay introduces three dismissal gestures a full page never
 * had: backdrop click, Escape, and the ✕. Each calls `Dialog`'s `onClose`
 * directly, so without a seam they navigate away and silently discard unsaved
 * edits. The existing dirty guards do NOT cover them — `SettingsPanel`'s is
 * wired to its own back arrow, `InstructionsPage`'s to file-switch and mobile
 * back.
 *
 * Per clarification C3 the guard is panel-level OPT-IN: a surface with no dirty
 * concept (and every plugin claim) keeps dismissing immediately.
 *
 * See change: add-route-backed-overlay-dialogs (task 6.1).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOverlayDismissGuard } from "../overlay-dismiss-guard.js";
import { RouteBackedOverlay } from "../RouteBackedOverlay.js";

afterEach(cleanup);

const BG = { path: "/", search: "" };

/** A panel that opts in only while `dirty`, recording intercepted attempts. */
function GuardedPanel({ dirty, onAttempt }: { dirty: boolean; onAttempt: () => void }) {
  useOverlayDismissGuard(dirty, onAttempt);
  return <div data-testid="panel">panel</div>;
}

/** A panel with no dirty concept — never opts in. */
function PlainPanel() {
  return <div data-testid="panel">panel</div>;
}

function renderOverlay(child: React.ReactNode, onDismiss: () => void) {
  return render(
    <RouteBackedOverlay
      background={BG}
      backgroundContent={<div>underlay</div>}
      onDismiss={onDismiss}
      testId="ov"
    >
      {child}
    </RouteBackedOverlay>,
  );
}

describe("6.1 — a dirty surface survives every dismissal gesture", () => {
  const gestures: [string, () => void][] = [
    ["backdrop click", () => fireEvent.click(screen.getByTestId("ov-overlay"))],
    ["Escape", () => fireEvent.keyDown(document, { key: "Escape" })],
    ["the ✕ affordance", () => fireEvent.click(screen.getByTestId("ov-close"))],
  ];

  for (const [name, fire] of gestures) {
    it(`${name} does not discard — the panel is asked instead`, () => {
      const onDismiss = vi.fn();
      const onAttempt = vi.fn();
      renderOverlay(<GuardedPanel dirty onAttempt={onAttempt} />, onDismiss);

      fire();

      expect(onDismiss).not.toHaveBeenCalled();
      expect(onAttempt).toHaveBeenCalledTimes(1);
      // The surface is still mounted — nothing was thrown away.
      expect(screen.getByTestId("panel")).toBeTruthy();
    });
  }
});

describe("6.5 — a clean surface still dismisses immediately", () => {
  it("dismisses when the guarded panel is not dirty", () => {
    const onDismiss = vi.fn();
    const onAttempt = vi.fn();
    renderOverlay(<GuardedPanel dirty={false} onAttempt={onAttempt} />, onDismiss);

    fireEvent.click(screen.getByTestId("ov-overlay"));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onAttempt).not.toHaveBeenCalled();
  });

  it("dismisses for a panel that never opts in (C3: plugin claims unaffected)", () => {
    const onDismiss = vi.fn();
    renderOverlay(<PlainPanel />, onDismiss);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("releases the guard when the panel goes clean again (e.g. after Save)", () => {
    const onDismiss = vi.fn();
    const onAttempt = vi.fn();
    const { rerender } = render(
      <RouteBackedOverlay background={BG} backgroundContent={<div />} onDismiss={onDismiss} testId="ov">
        <GuardedPanel dirty onAttempt={onAttempt} />
      </RouteBackedOverlay>,
    );

    fireEvent.click(screen.getByTestId("ov-overlay"));
    expect(onDismiss).not.toHaveBeenCalled();

    // Save clears the dirty flag.
    rerender(
      <RouteBackedOverlay background={BG} backgroundContent={<div />} onDismiss={onDismiss} testId="ov">
        <GuardedPanel dirty={false} onAttempt={onAttempt} />
      </RouteBackedOverlay>,
    );

    fireEvent.click(screen.getByTestId("ov-overlay"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("releases the guard when the guarded panel unmounts", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <RouteBackedOverlay background={BG} backgroundContent={<div />} onDismiss={onDismiss} testId="ov">
        <GuardedPanel dirty onAttempt={() => {}} />
      </RouteBackedOverlay>,
    );
    // Switching to a page with no dirty concept must not leave the overlay
    // permanently undismissable.
    rerender(
      <RouteBackedOverlay background={BG} backgroundContent={<div />} onDismiss={onDismiss} testId="ov">
        <PlainPanel />
      </RouteBackedOverlay>,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
