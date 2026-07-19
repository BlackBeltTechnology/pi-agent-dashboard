import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { mdiAlert } from "@mdi/js";
import { Dialog } from "../Dialog.js";

afterEach(() => cleanup());

describe("Dialog", () => {
  it("renders nothing when closed", () => {
    const { baseElement } = render(
      <Dialog open={false} onClose={() => {}} testId="d">
        <p>hi</p>
      </Dialog>,
    );
    expect(baseElement.querySelector("[data-testid='d']")).toBeNull();
  });

  it("renders at document.body via portal when open", () => {
    const { baseElement } = render(
      <Dialog open onClose={() => {}} testId="d">
        <p>body</p>
      </Dialog>,
    );
    const container = baseElement.querySelector("[data-testid='d']");
    expect(container).toBeTruthy();
    expect(container!.getAttribute("role")).toBe("dialog");
    expect(container!.getAttribute("aria-modal")).toBe("true");
  });

  it("calls onClose on Esc", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} testId="d">
        <p>x</p>
      </Dialog>,
    );
    // Escape now routes through the shared escape-stack (document-bubble listener).
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on overlay click", () => {
    const onClose = vi.fn();
    const { baseElement } = render(
      <Dialog open onClose={onClose} testId="d">
        <p>x</p>
      </Dialog>,
    );
    fireEvent.click(baseElement.querySelector("[data-testid='d-overlay']")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when clicking inside the container", () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <Dialog open onClose={onClose} testId="d">
        <p>inside</p>
      </Dialog>,
    );
    fireEvent.click(getByText("inside"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("sets aria-labelledby when title is given", () => {
    const { baseElement } = render(
      <Dialog open onClose={() => {}} title="Hello" testId="d">
        <p>x</p>
      </Dialog>,
    );
    const container = baseElement.querySelector("[data-testid='d']")!;
    const labelledBy = container.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)!.textContent).toBe("Hello");
  });

  it("omits aria-labelledby and header without title/icon", () => {
    const { baseElement } = render(
      <Dialog open onClose={() => {}} testId="d">
        <p>x</p>
      </Dialog>,
    );
    const container = baseElement.querySelector("[data-testid='d']")!;
    expect(container.getAttribute("aria-labelledby")).toBeNull();
    expect(container.querySelector("h3")).toBeNull();
  });

  it("renders header icon + title", () => {
    const { baseElement } = render(
      <Dialog open onClose={() => {}} title="T" icon={mdiAlert} testId="d">
        <p>x</p>
      </Dialog>,
    );
    const container = baseElement.querySelector("[data-testid='d']")!;
    expect(container.querySelector("h3")!.textContent).toBe("T");
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("applies overlay tint and z-index chrome", () => {
    const { baseElement } = render(
      <Dialog open onClose={() => {}} testId="d">
        <p>x</p>
      </Dialog>,
    );
    const overlay = baseElement.querySelector("[data-testid='d-overlay']")!;
    expect(overlay.className).toContain("bg-black/60");
    const root = overlay.parentElement!;
    expect(root.className).toContain("z-[60]");
    const container = baseElement.querySelector("[data-testid='d']")!;
    expect(container.className).toContain("bg-[var(--bg-primary)]");
    expect(container.className).toContain("border-[var(--border-primary)]");
  });

  it.each([
    ["sm", "max-w-sm"],
    ["md", "max-w-md"],
    ["lg", "max-w-lg"],
    ["full", "max-w-[95vw]"],
  ] as const)("applies %s size class %s", (size, cls) => {
    const { baseElement } = render(
      <Dialog open onClose={() => {}} size={size} testId="d">
        <p>x</p>
      </Dialog>,
    );
    expect(baseElement.querySelector("[data-testid='d']")!.className).toContain(cls);
  });

  it.each([
    ["sm", "max-h-[80vh]"],
    ["md", "max-h-[80vh]"],
    ["lg", "max-h-[80vh]"],
    ["full", "max-h-[92vh]"],
  ] as const)("applies %s height cap %s", (size, cls) => {
    const { baseElement } = render(
      <Dialog open onClose={() => {}} size={size} testId="d">
        <p>x</p>
      </Dialog>,
    );
    expect(baseElement.querySelector("[data-testid='d']")!.className).toContain(cls);
  });

  it("flush drops padding and clips overflow (edge-to-edge body)", () => {
    const { baseElement } = render(
      <Dialog open onClose={() => {}} flush testId="d">
        <p>x</p>
      </Dialog>,
    );
    const cls = baseElement.querySelector("[data-testid='d']")!.className;
    expect(cls).toContain("overflow-hidden");
    expect(cls).not.toContain("p-5");
  });

  it("non-flush keeps padding + scroll", () => {
    const { baseElement } = render(
      <Dialog open onClose={() => {}} testId="d">
        <p>x</p>
      </Dialog>,
    );
    const cls = baseElement.querySelector("[data-testid='d']")!.className;
    expect(cls).toContain("p-5");
    expect(cls).toContain("overflow-y-auto");
  });

  it("defaults to max-w-md", () => {
    const { baseElement } = render(
      <Dialog open onClose={() => {}} testId="d">
        <p>x</p>
      </Dialog>,
    );
    expect(baseElement.querySelector("[data-testid='d']")!.className).toContain(
      "max-w-md",
    );
  });

  it("maps action intents to classes and derives testIds", () => {
    const onAction = vi.fn();
    const onCancel = vi.fn();
    const { baseElement } = render(
      <Dialog open onClose={() => {}} testId="d">
        <Dialog.Footer>
          <Dialog.Cancel onClick={onCancel} testId="d-cancel" />
          <Dialog.Action onClick={onAction} intent="danger" testId="d-action">
            Go
          </Dialog.Action>
        </Dialog.Footer>
      </Dialog>,
    );
    const action = baseElement.querySelector("[data-testid='d-action']")!;
    expect(action.className).toContain("bg-red-600");
    const cancel = baseElement.querySelector("[data-testid='d-cancel']")!;
    fireEvent.click(cancel);
    fireEvent.click(action);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("primary intent uses accent, neutral uses border", () => {
    const { baseElement } = render(
      <Dialog open onClose={() => {}} testId="d">
        <Dialog.Action onClick={() => {}} testId="p">
          P
        </Dialog.Action>
        <Dialog.Action onClick={() => {}} intent="neutral" testId="n">
          N
        </Dialog.Action>
      </Dialog>,
    );
    expect(baseElement.querySelector("[data-testid='p']")!.className).toContain(
      "bg-[var(--accent-primary)]",
    );
    expect(baseElement.querySelector("[data-testid='n']")!.className).toContain(
      "border-[var(--border-primary)]",
    );
  });
});
