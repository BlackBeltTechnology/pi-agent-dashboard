import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { Confirm } from "../Confirm.js";

afterEach(() => cleanup());

describe("Confirm", () => {
  it("renders title and message", () => {
    const { getByText, baseElement } = render(
      <Confirm
        open
        onClose={() => {}}
        onConfirm={() => {}}
        title="Forget workspace?"
        message="This cannot be undone."
        testId="c"
      />,
    );
    expect(getByText("Forget workspace?")).toBeTruthy();
    expect(getByText("This cannot be undone.")).toBeTruthy();
    const container = baseElement.querySelector("[data-testid='c']")!;
    expect(container.getAttribute("aria-labelledby")).toBeTruthy();
  });

  it("renders optional body node", () => {
    const { getByTestId } = render(
      <Confirm
        open
        onClose={() => {}}
        onConfirm={() => {}}
        title="t"
        message="m"
        body={<ul data-testid="files" />}
      />,
    );
    expect(getByTestId("files")).toBeTruthy();
  });

  it("uses default labels", () => {
    const { getByText } = render(
      <Confirm open onClose={() => {}} onConfirm={() => {}} title="t" message="m" />,
    );
    expect(getByText("Confirm")).toBeTruthy();
    expect(getByText("Cancel")).toBeTruthy();
  });

  it("uses custom labels", () => {
    const { getByText } = render(
      <Confirm
        open
        onClose={() => {}}
        onConfirm={() => {}}
        title="t"
        message="m"
        confirmLabel="Forget"
        cancelLabel="Keep"
      />,
    );
    expect(getByText("Forget")).toBeTruthy();
    expect(getByText("Keep")).toBeTruthy();
  });

  it("#U12 maps the default (primary) intent to the --accent-solid fill", () => {
    const { baseElement } = render(
      <Confirm open onClose={() => {}} onConfirm={() => {}} title="t" message="m" testId="c" />,
    );
    const cls = baseElement.querySelector("[data-testid='c-action']")!.className;
    expect(cls).toContain("bg-[var(--accent-solid)]");
    expect(cls).not.toContain("bg-[var(--accent-primary)]");
  });

  it("maps danger intent to action button class", () => {
    const { baseElement } = render(
      <Confirm
        open
        onClose={() => {}}
        onConfirm={() => {}}
        title="t"
        message="m"
        intent="danger"
        testId="c"
      />,
    );
    // Danger is the red tint triple (align-ui-contract-recipes), no raw red fill.
    const cls = baseElement.querySelector("[data-testid='c-action']")!.className;
    expect(cls).toContain("bg-[var(--tint-red-bg)]");
    expect(cls).toContain("text-[var(--tint-red-fg)]");
    expect(cls).not.toContain("bg-red-600");
  });

  it("action calls onConfirm only; cancel/Esc call onClose only", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const { baseElement } = render(
      <Confirm
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="t"
        message="m"
        testId="c"
      />,
    );
    fireEvent.click(baseElement.querySelector("[data-testid='c-action']")!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(baseElement.querySelector("[data-testid='c-cancel']")!);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

// ── defaultFocus="cancel" ── See change: sidebar-folder-ux (test-plan #S19, #S23).
describe("Confirm — defaultFocus", () => {
  const props = { open: true, onClose: () => {}, onConfirm: () => {}, title: "t", message: "m" };

  it('defaultFocus="cancel" focuses Cancel and Enter cancels, not confirms', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const { getByText } = render(
      <Confirm {...props} onClose={onClose} onConfirm={onConfirm} intent="danger" defaultFocus="cancel" />,
    );
    const cancel = getByText("Cancel");
    expect(document.activeElement).toBe(cancel);
    // A focused <button> activates on Enter/Space via click; emulate that.
    fireEvent.click(document.activeElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("without defaultFocus focus is unchanged (first focusable, not Cancel)", () => {
    const { getByText } = render(<Confirm {...props} intent="danger" />);
    expect(document.activeElement).not.toBe(getByText("Cancel"));
  });

  it("Tab wraps within the dialog with focus starting on Cancel", () => {
    const { baseElement, getByText } = render(
      <Confirm {...props} intent="danger" defaultFocus="cancel" testId="c" />,
    );
    const dialog = baseElement.querySelector("[data-testid='c']")!;
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>("button"));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    expect(document.activeElement).toBe(getByText("Cancel"));
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
