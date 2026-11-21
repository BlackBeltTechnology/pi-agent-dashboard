import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import React, { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useFocusTrap } from "../useFocusTrap.js";

afterEach(() => cleanup());

function Harness({ open }: { open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);
  if (!open) return null;
  return (
    <div ref={ref} tabIndex={-1} data-testid="trap">
      <button data-testid="first">First</button>
      <button data-testid="mid">Mid</button>
      <button data-testid="last">Last</button>
    </div>
  );
}

/**
 * A child that renders NOTHING focusable on first paint and fills in a tick
 * later — the real shape of `/settings/general` inside a flush dialog (0
 * focusables at mount, 51 once its data lands). See change:
 * fix-flush-dialog-scroll-and-close-collision.
 */
function LateHarness({ late, mode = "insert" }: { late: boolean; mode?: "insert" | "enable" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = React.useState(false);
  useFocusTrap(ref, true);
  React.useEffect(() => {
    if (late) setReady(true);
  }, [late]);
  return (
    <div ref={ref} tabIndex={-1} data-testid="trap">
      <span>not focusable</span>
      {/* "insert" = the focusable is ADDED to the tree; "enable" = it is present
          from the start but `disabled`, so it becomes focusable through an
          ATTRIBUTE mutation with no node insertion at all. */}
      {mode === "enable" ? (
        <button data-testid="late" disabled={!ready}>
          Late
        </button>
      ) : (
        ready && <button data-testid="late">Late</button>
      )}
    </div>
  );
}

describe("useFocusTrap", () => {
  it("focuses the first focusable child on open", () => {
    const { getByTestId } = render(<Harness open={true} />);
    expect(document.activeElement).toBe(getByTestId("first"));
  });

  it("wraps Tab from last to first", () => {
    const { getByTestId } = render(<Harness open={true} />);
    const last = getByTestId("last");
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(getByTestId("first"));
  });

  it("wraps Shift+Tab from first to last", () => {
    const { getByTestId } = render(<Harness open={true} />);
    const first = getByTestId("first");
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(getByTestId("last"));
  });

  it("restores focus to the previously-focused element on close", () => {
    const outside = document.createElement("button");
    outside.setAttribute("data-testid", "outside");
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    const { rerender } = render(<Harness open={true} />);
    // focus moved into the trap
    expect(document.activeElement).not.toBe(outside);

    rerender(<Harness open={false} />);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("focuses the container itself when no focusable child exists", () => {
    function Empty() {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref, true);
      return <div ref={ref} tabIndex={-1} data-testid="empty" />;
    }
    const { getByTestId } = render(<Empty />);
    expect(document.activeElement).toBe(getByTestId("empty"));
  });
});

describe("useFocusTrap — late-arriving focusables", () => {
  it("hands focus to the first focusable that appears after mount", async () => {
    const { getByTestId } = render(<LateHarness late />);
    // Nothing focusable at mount → the documented container fallback.
    await waitFor(() => expect(document.activeElement).toBe(getByTestId("late")));
  });

  it("hands focus over when a disabled control is ENABLED, with no node inserted", async () => {
    const { getByTestId } = render(<LateHarness late mode="enable" />);
    await waitFor(() => expect(document.activeElement).toBe(getByTestId("late")));
  });

  it("does NOT take focus back once the user has moved it elsewhere", async () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const { getByTestId, rerender } = render(<LateHarness late={false} />);
    expect(document.activeElement).toBe(getByTestId("trap"));

    // The user tabs/clicks away BEFORE the surface fills in.
    outside.focus();
    expect(document.activeElement).toBe(outside);

    rerender(<LateHarness late />);
    await waitFor(() => expect(getByTestId("late")).toBeTruthy());
    // Node existence is NOT observer delivery: MutationObserver callbacks run at
    // the microtask checkpoint, so a macrotask hop is what guarantees any
    // pending handoff has already had its chance to fire. Without it this
    // assertion could pass before the observer ever ran.
    await new Promise((r) => setTimeout(r, 0));
    // The late focusable exists — and focus was left exactly where the user put it.
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("does NOT focus a late focusable inside an aria-hidden subtree", async () => {
    function HiddenLate() {
      const ref = useRef<HTMLDivElement>(null);
      const [ready, setReady] = React.useState(false);
      useFocusTrap(ref, true);
      React.useEffect(() => setReady(true), []);
      return (
        <div ref={ref} tabIndex={-1} data-testid="trap">
          <div aria-hidden="true">{ready && <button data-testid="buried">Buried</button>}</div>
        </div>
      );
    }
    const { getByTestId } = render(<HiddenLate />);
    await waitFor(() => expect(getByTestId("buried")).toBeTruthy());
    await new Promise((r) => setTimeout(r, 0));
    // The button exists but lives under `aria-hidden` — focus must stay put
    // rather than land somewhere assistive technology cannot see.
    expect(document.activeElement).toBe(getByTestId("trap"));
  });

  it("leaves a genuinely focusable-less child on the container", async () => {
    const { getByTestId } = render(<LateHarness late={false} />);
    expect(document.activeElement).toBe(getByTestId("trap"));
    await new Promise((r) => setTimeout(r, 20));
    expect(document.activeElement).toBe(getByTestId("trap"));
  });
});

// ── data-autofocus: opt-in default focus target ──
// See change: sidebar-folder-ux (test-plan #S20, #S22).
function MarkedHarness({ markup }: { markup: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true);
  return (
    <div ref={ref} tabIndex={-1} data-testid="trap">
      {markup}
    </div>
  );
}

describe("useFocusTrap — data-autofocus", () => {
  it("focuses the marked control instead of the first focusable", () => {
    const { getByTestId } = render(
      <MarkedHarness
        markup={
          <>
            <button data-testid="close">✕</button>
            <button data-testid="cancel" data-autofocus>
              Cancel
            </button>
          </>
        }
      />,
    );
    expect(document.activeElement).toBe(getByTestId("cancel"));
  });

  it("falls back to the first focusable when nothing is marked", () => {
    const { getByTestId } = render(
      <MarkedHarness
        markup={
          <>
            <button data-testid="close">✕</button>
            <button data-testid="cancel">Cancel</button>
          </>
        }
      />,
    );
    expect(document.activeElement).toBe(getByTestId("close"));
  });

  it("with several marked controls focuses the first in DOM order", () => {
    const { getByTestId } = render(
      <MarkedHarness
        markup={
          <>
            <button data-testid="close">✕</button>
            <button data-testid="a" data-autofocus>
              A
            </button>
            <button data-testid="b" data-autofocus>
              B
            </button>
          </>
        }
      />,
    );
    expect(document.activeElement).toBe(getByTestId("a"));
  });

  it("skips a marked control that is hidden (own attribute or ancestor)", () => {
    const { getByTestId } = render(
      <MarkedHarness
        markup={
          <>
            <button data-testid="close">✕</button>
            <button data-testid="hid" data-autofocus aria-hidden="true">
              Hidden
            </button>
            <div hidden>
              <button data-testid="hid2" data-autofocus>
                Hidden too
              </button>
            </div>
          </>
        }
      />,
    );
    expect(document.activeElement).toBe(getByTestId("close"));
  });

  it("late arrival: focus moves once, to the marked control, and is not taken back", async () => {
    function LateMarked() {
      const ref = useRef<HTMLDivElement>(null);
      const [ready, setReady] = React.useState(false);
      useFocusTrap(ref, true);
      React.useEffect(() => setReady(true), []);
      return (
        <div ref={ref} tabIndex={-1} data-testid="trap">
          {ready && (
            <>
              <button data-testid="plain">Plain</button>
              <button data-testid="marked" data-autofocus>
                Marked
              </button>
            </>
          )}
        </div>
      );
    }
    const { getByTestId } = render(<LateMarked />);
    await waitFor(() => expect(document.activeElement).toBe(getByTestId("marked")));
    // The user moves focus on; the one-shot handoff must not steal it back.
    getByTestId("plain").focus();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(getByTestId("plain"));
  });

  it("late arrival with nothing marked still focuses the first focusable", async () => {
    function LateUnmarked() {
      const ref = useRef<HTMLDivElement>(null);
      const [ready, setReady] = React.useState(false);
      useFocusTrap(ref, true);
      React.useEffect(() => setReady(true), []);
      return (
        <div ref={ref} tabIndex={-1} data-testid="trap">
          {ready && (
            <>
              <button data-testid="one">One</button>
              <button data-testid="two">Two</button>
            </>
          )}
        </div>
      );
    }
    const { getByTestId } = render(<LateUnmarked />);
    await waitFor(() => expect(document.activeElement).toBe(getByTestId("one")));
  });
});
