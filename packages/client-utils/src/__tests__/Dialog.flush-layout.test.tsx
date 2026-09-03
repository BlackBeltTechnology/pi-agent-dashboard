/**
 * Dialog — flush layout contract + close-control decision table.
 *
 * These are the L1 rows of `fix-flush-dialog-scroll-and-close-collision`'s
 * test plan (E1–E4, E9, E10, X4). They assert CLASS CONTRACTS, not geometry:
 * jsdom has no layout engine, so the rendered box of a flush dialog is
 * structurally unobservable here. The geometry half lives in
 * `tests/e2e/overlay-layout.spec.ts`.
 *
 * See change: fix-flush-dialog-scroll-and-close-collision.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { Dialog, type DialogSize } from "../Dialog.js";
import { registerEscapeLayer, __resetEscapeStack } from "../escape-stack.js";

afterEach(() => {
  cleanup();
  __resetEscapeStack();
});

const panel = (baseElement: HTMLElement) =>
  baseElement.querySelector("[data-testid='d']") as HTMLElement;

describe("Dialog flush layout (E1/E2/E4)", () => {
  it("E1: flush establishes a flex column that may shrink below content", () => {
    const { baseElement } = render(
      <Dialog open onClose={() => {}} flush testId="d">
        <p>x</p>
      </Dialog>,
    );
    const cls = panel(baseElement).className;
    expect(cls).toContain("flex");
    expect(cls).toContain("flex-col");
    expect(cls).toContain("min-h-0");
    expect(cls).toContain("overflow-hidden");
    expect(cls).not.toContain("p-5");
    expect(cls).not.toContain("overflow-y-auto");
  });

  it("E2: non-flush is unchanged — padding + scroll, and NO flex context", () => {
    const { baseElement } = render(
      <Dialog open onClose={() => {}} testId="d">
        <p>x</p>
      </Dialog>,
    );
    const cls = panel(baseElement).className;
    expect(cls).toContain("p-5");
    expect(cls).toContain("overflow-y-auto");
    // The non-flush branch must come out byte-identical: no flex token may leak
    // into it. `flex-col`/`min-h-0` are checked separately from the bare `flex`
    // word-boundary match so `max-w-*` etc. cannot accidentally satisfy it.
    expect(cls.split(/\s+/)).not.toContain("flex");
    expect(cls.split(/\s+/)).not.toContain("flex-col");
    expect(cls.split(/\s+/)).not.toContain("min-h-0");
  });

  it.each([
    ["sm", "max-h-[80vh]"],
    ["md", "max-h-[80vh]"],
    ["lg", "max-h-[80vh]"],
    ["full", "max-h-[92vh]"],
  ] as const)(
    "E4: %s height cap %s is identical in both flush modes",
    (size: DialogSize, cap: string) => {
      const { baseElement, unmount } = render(
        <Dialog open onClose={() => {}} size={size} testId="d">
          <p>x</p>
        </Dialog>,
      );
      expect(panel(baseElement).className).toContain(cap);
      unmount();

      const flushRender = render(
        <Dialog open onClose={() => {}} size={size} flush testId="d">
          <p>x</p>
        </Dialog>,
      );
      expect(panel(flushRender.baseElement).className).toContain(cap);
    },
  );
});

describe("Dialog close-control decision table (E3)", () => {
  it.each([
    [false, false, true],
    [false, true, true],
    [true, false, false],
    [true, true, true],
  ])("E3: flush=%s showClose=%s → ✕ rendered=%s", (flush, showClose, present) => {
    const { baseElement } = render(
      <Dialog open onClose={() => {}} flush={flush} showClose={showClose} testId="d">
        <p>x</p>
      </Dialog>,
    );
    const close = baseElement.querySelector("[data-testid='d-close']");
    expect(Boolean(close)).toBe(present);
  });

  it("E3: the restored ✕ still dismisses", () => {
    const onClose = vi.fn();
    const { baseElement } = render(
      <Dialog open onClose={onClose} flush showClose testId="d">
        <p>x</p>
      </Dialog>,
    );
    fireEvent.click(baseElement.querySelector("[data-testid='d-close']")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Dialog dismissal is untouched by flush (E9/E10)", () => {
  it("E9: Escape over a stacked overlay does not close the flush dialog", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} flush testId="d">
        <p>x</p>
      </Dialog>,
    );
    // A layer registered AFTER the dialog is topmost on the shared stack.
    const above = vi.fn();
    registerEscapeLayer("above", above);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(above).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("E10: the parent owns the open state — a no-op onClose leaves it mounted", () => {
    const onClose = vi.fn();
    const { baseElement } = render(
      <Dialog open onClose={onClose} flush testId="d">
        <p>x</p>
      </Dialog>,
    );
    fireEvent.click(baseElement.querySelector("[data-testid='d-overlay']")!);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(panel(baseElement)).toBeTruthy();
  });
});

describe("showClose rescues a zero-focusable flush child (X4)", () => {
  // The documented plugin hazard: `flush` suppresses the ✕, and a third-party
  // child that renders no focusable element of its own then leaves the focus
  // trap with nothing to focus. `showClose` is the specified escape hatch.
  const Degenerate = () => <p>no focusable element here</p>;

  it("X4: with showClose the ✕ exists and takes initial focus", () => {
    const { baseElement } = render(
      <Dialog open onClose={() => {}} flush showClose testId="d">
        <Degenerate />
      </Dialog>,
    );
    const close = baseElement.querySelector("[data-testid='d-close']");
    expect(close).toBeTruthy();
    expect(document.activeElement).toBe(close);
  });

  it("X4: without showClose focus falls back to the container", () => {
    const { baseElement } = render(
      <Dialog open onClose={() => {}} flush testId="d">
        <Degenerate />
      </Dialog>,
    );
    expect(baseElement.querySelector("[data-testid='d-close']")).toBeNull();
    expect(document.activeElement).toBe(panel(baseElement));
  });
});
