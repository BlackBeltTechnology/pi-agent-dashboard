/**
 * QueuePanel — follow-up queue with bridge-owned mutation surface.
 *
 * The bridge owns `bridgeFollowUp` (pi 0.76.0 ExtensionAPI exposes no
 * queue-mutation primitives, so the bridge must own the buffer to enable
 * mutation honestly). The panel renders:
 *   - ↑/↓ cycler (read-only navigation across entries)
 *   - [✎] inline edit
 *   - [✕] remove
 *   - [⇧] promote-to-head
 *   - [→ editor] pull-to-editor (round-trips followup_pulled to draft)
 *   - header [✖️] clear-all (shown only when length > 1)
 *
 * Steer is NOT in this panel (permanently pi-owned + inline ghost bubbles
 * in ChatView — see change: rework-mid-turn-prompt-queue D5).
 *
 * See change: rework-mid-turn-prompt-queue (spec mid-turn-prompt-queue).
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { QueuePanel } from "../session/QueuePanel.js";

afterEach(() => cleanup());

describe("QueuePanel — basic rendering", () => {
  it("renders nothing when follow-up queue is empty", () => {
    const { container } = render(<QueuePanel followUp={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a single entry with mutation buttons (but no navigation)", () => {
    const { getByTestId, queryByTestId } = render(<QueuePanel followUp={["only one"]} />);
    expect(getByTestId("queue-panel")).toBeTruthy();
    expect(getByTestId("queue-panel-followup")).toBeTruthy();
    expect(getByTestId("queue-chip-followup").textContent).toBe("only one");

    // Mutation controls present even for single-entry
    expect(getByTestId("queue-followup-edit")).toBeTruthy();
    expect(getByTestId("queue-followup-remove")).toBeTruthy();
    expect(getByTestId("queue-followup-promote")).toBeTruthy();
    expect(queryByTestId("queue-followup-pull")).toBeNull(); // pull-to-editor removed per user direction

    // Cycler nav + position indicator + clear-all absent for single-entry
    expect(queryByTestId("queue-followup-prev")).toBeNull();
    expect(queryByTestId("queue-followup-next")).toBeNull();
    expect(queryByTestId("queue-followup-position")).toBeNull();
    expect(queryByTestId("queue-followup-clear-all")).toBeNull();
  });

  it("renders multi-entry with cycler + position indicator + clear-all", () => {
    const { getByTestId } = render(<QueuePanel followUp={["alpha", "beta", "gamma"]} />);
    expect(getByTestId("queue-followup-prev")).toBeTruthy();
    expect(getByTestId("queue-followup-next")).toBeTruthy();
    expect(getByTestId("queue-followup-clear-all")).toBeTruthy();
    // Initial: last entry visible
    expect(getByTestId("queue-chip-followup").textContent).toBe("gamma");
    expect(getByTestId("queue-followup-position").textContent).toMatch(/3.*3/);
  });

  it("display chip caps height and scrolls on overflow (max-h-80 overflow-auto)", () => {
    const { getByTestId } = render(<QueuePanel followUp={["long entry"]} />);
    const chip = getByTestId("queue-chip-followup");
    expect(chip.className).toContain("max-h-80");
    expect(chip.className).toContain("overflow-auto");
  });
});

describe("QueuePanel — cycler navigation (display-only)", () => {
  it("up arrow navigates to previous entry without dispatch", () => {
    const onPromote = vi.fn();
    const { getByTestId } = render(
      <QueuePanel followUp={["alpha", "beta", "gamma"]} onPromote={onPromote} />,
    );
    expect(getByTestId("queue-chip-followup").textContent).toBe("gamma");
    fireEvent.click(getByTestId("queue-followup-prev"));
    expect(getByTestId("queue-chip-followup").textContent).toBe("beta");
    fireEvent.click(getByTestId("queue-followup-prev"));
    expect(getByTestId("queue-chip-followup").textContent).toBe("alpha");
    // No mutation dispatched by navigation
    expect(onPromote).not.toHaveBeenCalled();
  });

  it("up arrow disabled at first entry; down arrow disabled at last", () => {
    const { getByTestId } = render(<QueuePanel followUp={["a", "b"]} />);
    // Initial currentIndex = 1 (last); next disabled
    expect((getByTestId("queue-followup-next") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(getByTestId("queue-followup-prev"));
    expect((getByTestId("queue-followup-prev") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("QueuePanel — promote", () => {
  it("[⇧] dispatches onPromote with current index", () => {
    const onPromote = vi.fn();
    const { getByTestId } = render(
      <QueuePanel followUp={["a", "b", "c"]} onPromote={onPromote} />,
    );
    // initial idx = 2 (showing "c")
    fireEvent.click(getByTestId("queue-followup-promote"));
    expect(onPromote).toHaveBeenCalledWith(2);
  });

  it("[⇧] disabled when current entry is at index 0", () => {
    const { getByTestId } = render(<QueuePanel followUp={["a", "b"]} />);
    fireEvent.click(getByTestId("queue-followup-prev")); // navigate to idx=0
    const promote = getByTestId("queue-followup-promote") as HTMLButtonElement;
    expect(promote.disabled).toBe(true);
  });
});

describe("QueuePanel — remove", () => {
  it("[✕] dispatches onRemove with current index for short entries", () => {
    const onRemove = vi.fn();
    const { getByTestId } = render(
      <QueuePanel followUp={["short text"]} onRemove={onRemove} />,
    );
    fireEvent.click(getByTestId("queue-followup-remove"));
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it("[✕] confirms before dispatching for entries > 50 chars (accept)", () => {
    const onRemove = vi.fn();
    const longText = "a".repeat(60);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { getByTestId } = render(
      <QueuePanel followUp={[longText]} onRemove={onRemove} />,
    );
    fireEvent.click(getByTestId("queue-followup-remove"));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalledWith(0);
    confirmSpy.mockRestore();
  });

  it("[✕] does NOT dispatch when user cancels the confirmation", () => {
    const onRemove = vi.fn();
    const longText = "a".repeat(60);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { getByTestId } = render(
      <QueuePanel followUp={[longText]} onRemove={onRemove} />,
    );
    fireEvent.click(getByTestId("queue-followup-remove"));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe("QueuePanel — edit", () => {
  it("[✎] opens inline textarea editor", () => {
    const { getByTestId, queryByTestId } = render(<QueuePanel followUp={["orig"]} />);
    expect(queryByTestId("queue-followup-editor")).toBeNull();
    fireEvent.click(getByTestId("queue-followup-edit"));
    const editor = getByTestId("queue-followup-editor") as HTMLTextAreaElement;
    expect(editor).toBeTruthy();
    expect(editor.value).toBe("orig");
  });

  it("Cmd+Enter in editor dispatches onEdit(idx, text)", () => {
    const onEdit = vi.fn();
    const { getByTestId } = render(<QueuePanel followUp={["orig"]} onEdit={onEdit} />);
    fireEvent.click(getByTestId("queue-followup-edit"));
    const editor = getByTestId("queue-followup-editor") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "revised" } });
    fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
    expect(onEdit).toHaveBeenCalledWith(0, "revised");
  });

  it("Ctrl+Enter in editor also submits (cross-platform)", () => {
    const onEdit = vi.fn();
    const { getByTestId } = render(<QueuePanel followUp={["orig"]} onEdit={onEdit} />);
    fireEvent.click(getByTestId("queue-followup-edit"));
    const editor = getByTestId("queue-followup-editor") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "revised" } });
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    expect(onEdit).toHaveBeenCalledWith(0, "revised");
  });

  it("Esc cancels edit without dispatching", () => {
    const onEdit = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <QueuePanel followUp={["orig"]} onEdit={onEdit} />,
    );
    fireEvent.click(getByTestId("queue-followup-edit"));
    const editor = getByTestId("queue-followup-editor") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "discard me" } });
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(onEdit).not.toHaveBeenCalled();
    expect(queryByTestId("queue-followup-editor")).toBeNull();
  });

  it("Save button submits without keyboard shortcut", () => {
    const onEdit = vi.fn();
    const { getByTestId } = render(<QueuePanel followUp={["orig"]} onEdit={onEdit} />);
    fireEvent.click(getByTestId("queue-followup-edit"));
    const editor = getByTestId("queue-followup-editor") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "revised" } });
    fireEvent.click(getByTestId("queue-followup-editor-submit"));
    expect(onEdit).toHaveBeenCalledWith(0, "revised");
  });

  it("submit does NOT dispatch when text unchanged (avoid no-op queue_update)", () => {
    const onEdit = vi.fn();
    const { getByTestId } = render(<QueuePanel followUp={["orig"]} onEdit={onEdit} />);
    fireEvent.click(getByTestId("queue-followup-edit"));
    const editor = getByTestId("queue-followup-editor") as HTMLTextAreaElement;
    // Don't change anything; value stays "orig"
    fireEvent.click(getByTestId("queue-followup-editor-submit"));
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe("QueuePanel — clear-all", () => {
  it("header [✖] dispatches onClearAll when length > 1", () => {
    const onClearAll = vi.fn();
    const { getByTestId } = render(
      <QueuePanel followUp={["a", "b"]} onClearAll={onClearAll} />,
    );
    fireEvent.click(getByTestId("queue-followup-clear-all"));
    expect(onClearAll).toHaveBeenCalled();
  });

  it("header [✖] absent when length === 1", () => {
    const onClearAll = vi.fn();
    const { queryByTestId } = render(
      <QueuePanel followUp={["only one"]} onClearAll={onClearAll} />,
    );
    expect(queryByTestId("queue-followup-clear-all")).toBeNull();
  });
});

describe("QueuePanel — index clamping on rerender", () => {
  it("clamps currentIndex when the queue shrinks", () => {
    const { getByTestId, rerender } = render(
      <QueuePanel followUp={["a", "b", "c"]} />,
    );
    expect(getByTestId("queue-chip-followup").textContent).toBe("c");
    rerender(<QueuePanel followUp={["a", "b"]} />);
    // currentIndex was 2, should clamp to 1
    expect(getByTestId("queue-chip-followup").textContent).toBe("b");
  });

  it("jumps to new last entry when queue grows", () => {
    const { getByTestId, rerender } = render(<QueuePanel followUp={["a"]} />);
    rerender(<QueuePanel followUp={["a", "b"]} />);
    expect(getByTestId("queue-chip-followup").textContent).toBe("b");
    rerender(<QueuePanel followUp={["a", "b", "c"]} />);
    expect(getByTestId("queue-chip-followup").textContent).toBe("c");
  });
});
