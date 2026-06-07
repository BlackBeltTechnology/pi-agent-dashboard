import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
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
