import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React, { useRef } from "react";
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
    // The late focusable exists — and focus was left exactly where the user put it.
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("leaves a genuinely focusable-less child on the container", async () => {
    const { getByTestId } = render(<LateHarness late={false} />);
    expect(document.activeElement).toBe(getByTestId("trap"));
    await new Promise((r) => setTimeout(r, 20));
    expect(document.activeElement).toBe(getByTestId("trap"));
  });
});
