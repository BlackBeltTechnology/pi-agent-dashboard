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
    // The ✕ gesture is GONE, not untested: a route-backed overlay is a flush
    // Dialog, and a flush Dialog no longer renders a built-in ✕ (it duplicated
    // and overlapped the child's own header controls). Its absence is asserted
    // below rather than dropped, so this list shrinking cannot be mistaken for
    // lost coverage. See change: fix-flush-dialog-scroll-and-close-collision.
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

  it("renders no container ✕ at all — the removed gesture cannot come back untested", () => {
    renderOverlay(<GuardedPanel dirty onAttempt={vi.fn()} />, vi.fn());
    expect(screen.queryByTestId("ov-close")).toBeNull();
  });
});

// Audit finding (8.7, high): registration was last-write-wins on a single ref
// and deregistration was unconditional, so an inner guard's cleanup cleared the
// OUTER guard too. `SettingsPanel` arms on `isDirty` while its instructions tab
// renders `InstructionsPage`, which arms its own — the real, shipping case.
describe("8.7 — nested guards do not clobber each other", () => {
  function Nested({ inner, onOuter, onInner }: { inner: boolean; onOuter: () => void; onInner: () => void }) {
    useOverlayDismissGuard(true, onOuter);
    return inner ? <GuardedPanel dirty onAttempt={onInner} /> : <div data-testid="panel" />;
  }

  it("with both armed, dismissal is prevented and exactly one guard prompts", () => {
    const onDismiss = vi.fn();
    const onOuter = vi.fn();
    const onInner = vi.fn();
    renderOverlay(<Nested inner onOuter={onOuter} onInner={onInner} />, onDismiss);

    fireEvent.keyDown(document, { key: "Escape" });

    // Deliberately does NOT assert WHICH guard fires. React runs child effects
    // before parent ones, so stack order here is an artefact of effect
    // ordering, not a contract — pinning it would pin React internals. What
    // matters is that the edit survives and the user sees exactly one prompt.
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onOuter.mock.calls.length + onInner.mock.calls.length).toBe(1);
  });

  it("the OUTER guard survives the inner one unmounting", () => {
    const onDismiss = vi.fn();
    const onOuter = vi.fn();
    const onInner = vi.fn();
    const { rerender } = render(
      <RouteBackedOverlay background={BG} backgroundContent={<div />} onDismiss={onDismiss} testId="ov">
        <Nested inner onOuter={onOuter} onInner={onInner} />
      </RouteBackedOverlay>,
    );
    // Leave the instructions tab; the panel-level dirty state is still set.
    rerender(
      <RouteBackedOverlay background={BG} backgroundContent={<div />} onDismiss={onDismiss} testId="ov">
        <Nested inner={false} onOuter={onOuter} onInner={onInner} />
      </RouteBackedOverlay>,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    // Without identity-checked deregistration this dismisses and eats the edit.
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onOuter).toHaveBeenCalledTimes(1);
  });
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
