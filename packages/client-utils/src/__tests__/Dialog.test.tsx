import { mdiAlert } from "@mdi/js";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    // align-ui-contract-recipes: the scrim is the theme token, never a fixed black.
    expect(overlay.className).toContain("bg-[var(--bg-overlay)]");
    expect(overlay.className).not.toContain("bg-black");
    const root = overlay.parentElement!;
    // The `z-dialog` TOKEN, not a raw z-index. This used to be a raw `z-[60]`,
    // which put every dialog on the toast layer and ABOVE the documented
    // dialog layer -- so a confirm raised from inside a dialog (and correctly
    // tokenised at z-dialog) rendered underneath the dialog that raised it.
    // Nested dialogs now tie and resolve by portal/DOM order.
    // See change: add-route-backed-overlay-dialogs (task 6.2).
    expect(root.className).toContain("z-dialog");
    expect(root.className).not.toMatch(/z-\[\d+\]/);
    const container = baseElement.querySelector("[data-testid='d']")!;
    // Card recipe: secondary surface, secondary border, extra-large radius.
    expect(container.className).toContain("bg-[var(--bg-secondary)]");
    expect(container.className).toContain("border-[var(--border-secondary)]");
    expect(container.className).toContain("rounded-xl");
    expect(container.className).not.toContain("bg-[var(--bg-primary)]");
    expect(container.className).not.toContain("rounded-lg");
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
    // Danger is the red tint triple, not a raw palette fill.
    expect(action.className).toContain("bg-[var(--tint-red-bg)]");
    expect(action.className).toContain("text-[var(--tint-red-fg)]");
    expect(action.className).toContain("border-[var(--tint-red-border)]");
    expect(action.className).not.toContain("bg-red-600");
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
    // #U12 — primary fill is --accent-solid (5.17:1 under white), not
    // --accent-primary (3.68:1). See change: add-pi-spec-driven-schema.
    const primary = baseElement.querySelector("[data-testid='p']")!.className;
    expect(primary).toContain("bg-[var(--accent-solid)]");
    expect(primary).not.toContain("bg-[var(--accent-primary)]");
    expect(baseElement.querySelector("[data-testid='n']")!.className).toContain(
      "border-[var(--border-primary)]",
    );
  });
});

// align-ui-contract-recipes (test-plan #E10): the dialog decision table.
describe("Dialog contract recipe (#E10)", () => {
  const open = () =>
    render(
      <Dialog open onClose={() => {}} title="Switch branch" icon={mdiAlert} testId="d">
        <Dialog.Footer>
          <Dialog.Cancel onClick={() => {}} testId="cancel" />
          <Dialog.Action onClick={() => {}} testId="primary">
            Go
          </Dialog.Action>
          <Dialog.Action onClick={() => {}} intent="danger" testId="danger">
            Delete
          </Dialog.Action>
          <Dialog.Action onClick={() => {}} intent="neutral" testId="neutral">
            Later
          </Dialog.Action>
        </Dialog.Footer>
      </Dialog>,
    ).baseElement;
  const el = (b: HTMLElement, id: string) => b.querySelector(`[data-testid='${id}']`) as HTMLElement;

  it("title is text-lg semibold", () => {
    const h = el(open(), "d").querySelector("h3")!;
    expect(h.className).toContain("text-lg");
    expect(h.className).toContain("font-semibold");
    expect(h.className).not.toContain("text-base");
  });

  it("the header icon tile is the info severity triple, not an accent alpha", () => {
    const tile = el(open(), "d").querySelector("h3")!.previousElementSibling as HTMLElement;
    expect(tile.className).toContain("bg-[var(--severity-info-bg)]");
    expect(tile.className).toContain("text-[var(--severity-info-fg)]");
    expect(tile.className).toContain("border-[var(--severity-info-border)]");
    expect(tile.className).not.toContain("accent-primary");
  });

  it("actions, Cancel and the close button meet the 44 / 36 px target sizes", () => {
    const b = open();
    for (const id of ["primary", "danger", "neutral", "cancel"]) {
      const cls = el(b, id).className;
      expect(cls, id).toContain("min-h-[44px]");
      expect(cls, id).toContain("sm:min-h-[36px]");
      expect(cls, id).toContain("font-semibold");
    }
    const close = el(b, "d-close");
    expect(close.className).toContain("min-h-[44px]");
    expect(close.className).toContain("min-w-[44px]");
    expect(close.className).toContain("sm:min-h-[36px]");
    expect(close.className).toContain("sm:min-w-[36px]");
    expect(close.getAttribute("aria-label")).toBe("Close");
    expect(close.className).toContain("right-");
  });

  it("the header reserves room for the larger close button", () => {
    const header = el(open(), "d").querySelector("h3")!.parentElement as HTMLElement;
    expect(header.className).toContain("pr-12");
  });

  it("primary stays on the solid accent; neutral and Cancel share the border recipe", () => {
    const b = open();
    expect(el(b, "primary").className).toContain("bg-[var(--accent-solid)]");
    expect(el(b, "neutral").className).toContain("border-[var(--border-primary)]");
    expect(el(b, "cancel").className).toContain("border-[var(--border-primary)]");
  });

  it("paints no raw palette colour, hex or rgba anywhere in the dialog", () => {
    const html = open().querySelector("[data-testid='d']")!.parentElement!.outerHTML;
    expect(html).not.toMatch(/\b(?:bg|text|border|ring)-(?:red|green|blue|yellow|amber|orange)-\d/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toContain("rgba(");
    expect(html).not.toContain("bg-black");
  });

  it("a flush dialog without showClose still renders no close button", () => {
    const { baseElement } = render(
      <Dialog open onClose={() => {}} flush testId="f">
        <p>x</p>
      </Dialog>,
    );
    expect(baseElement.querySelector("[data-testid='f-close']")).toBeNull();
  });

  it("no header, no title: the close button still sits at the corner and the panel has no header element", () => {
    const { baseElement } = render(
      <Dialog open onClose={() => {}} ariaLabel="x" testId="n">
        <p>x</p>
      </Dialog>,
    );
    expect(baseElement.querySelector("[data-testid='n'] h3")).toBeNull();
    expect(baseElement.querySelector("[data-testid='n-close']")).toBeTruthy();
  });
});
