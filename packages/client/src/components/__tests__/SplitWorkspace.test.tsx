import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSplitState } from "../../lib/layout/split-state.js";
import { nextFrame, pointerDown, pointerMove, pointerUp } from "../../test-support/pointer.js";
import { SplitDivider } from "../split/SplitDivider.js";
import { SplitWorkspace } from "../split/SplitWorkspace.js";

afterEach(() => cleanup());

const chat = <div data-testid="chat">chat</div>;
const editor = <div data-testid="editor">editor</div>;

const noop = () => {};

/** Stub the split container's box so the divider drag maps pointer→ratio. */
function stubContainerBox(container: HTMLElement, left: number, width: number) {
  const root = container.firstElementChild as HTMLElement;
  root.getBoundingClientRect = () =>
    ({ left, width, top: 0, height: 400, right: left + width, bottom: 400, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
  return root;
}

describe("SplitWorkspace", () => {
  it("closed: chat + right-edge editor restore tab, no editor pane, no divider", () => {
    render(
      <SplitWorkspace mode="closed" ratio={0.5} orientation="h" onRatioChange={vi.fn()} onModeChange={noop} chat={chat} editor={editor} />,
    );
    expect(screen.getByTestId("chat")).toBeTruthy();
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(screen.queryByTestId("split-divider")).toBeNull();
    expect(screen.getByTestId("editor-peek")).toBeTruthy();
  });

  it("closed: editor restore tab reopens split", () => {
    const onModeChange = vi.fn();
    render(
      <SplitWorkspace mode="closed" ratio={0.5} orientation="h" onRatioChange={vi.fn()} onModeChange={onModeChange} chat={chat} editor={editor} />,
    );
    fireEvent.click(screen.getByTestId("editor-peek"));
    expect(onModeChange).toHaveBeenCalledWith("split");
  });

  it("split: renders chat + resize-only divider + editor", () => {
    render(
      <SplitWorkspace mode="split" ratio={0.5} orientation="h" onRatioChange={vi.fn()} onModeChange={noop} chat={chat} editor={editor} />,
    );
    expect(screen.getByTestId("chat")).toBeTruthy();
    expect(screen.getByTestId("editor")).toBeTruthy();
    expect(screen.getByTestId("split-divider")).toBeTruthy();
    // The CHAT caption bar was removed; no pane caption renders.
    expect(screen.queryByTestId("pane-caption-chat")).toBeNull();
  });

  it("E5: divider carries no collapse control; the dotted grip is present", () => {
    render(
      <SplitWorkspace mode="split" ratio={0.5} orientation="h" onRatioChange={vi.fn()} onModeChange={noop} chat={chat} editor={editor} />,
    );
    // No on-divider collapse chevrons (collapse is header-only now).
    expect(screen.queryByTestId("split-fold-chat")).toBeNull();
    expect(screen.queryByTestId("split-fold-editor")).toBeNull();
    // Always-visible dotted grip inside the divider.
    expect(screen.getByTestId("split-divider-grip")).toBeTruthy();
  });

  it("F10: collapse is header-only; restore tabs only re-open (never collapse)", () => {
    const onModeChange = vi.fn();
    // Split has no control that drives closed/full — only resize.
    const { rerender } = render(
      <SplitWorkspace mode="split" ratio={0.5} orientation="h" onRatioChange={vi.fn()} onModeChange={onModeChange} chat={chat} editor={editor} />,
    );
    expect(screen.queryByTestId("chat-peek")).toBeNull();
    expect(screen.queryByTestId("editor-peek")).toBeNull();
    // Restore tabs appear only when collapsed and only re-open split.
    rerender(
      <SplitWorkspace mode="closed" ratio={0.5} orientation="h" onRatioChange={vi.fn()} onModeChange={onModeChange} chat={chat} editor={editor} />,
    );
    fireEvent.click(screen.getByTestId("editor-peek"));
    rerender(
      <SplitWorkspace mode="full" ratio={0.5} orientation="h" onRatioChange={vi.fn()} onModeChange={onModeChange} chat={chat} editor={editor} />,
    );
    fireEvent.click(screen.getByTestId("chat-peek"));
    expect(onModeChange.mock.calls.every(([m]) => m === "split")).toBe(true);
  });

  // E12 — one commit per drag, after release.
  it("E12: many held moves → one onRatioChange, after release, with the final ratio", async () => {
    const onRatioChange = vi.fn();
    const { container } = render(
      <SplitWorkspace mode="split" ratio={0.5} orientation="h" onRatioChange={onRatioChange} onModeChange={noop} chat={chat} editor={editor} />,
    );
    stubContainerBox(container, 0, 1000);
    pointerDown(screen.getByTestId("split-divider"), { clientX: 500 });
    for (const x of [520, 540, 560, 580, 600]) {
      pointerMove(window, { clientX: x });
      await nextFrame();
    }
    expect(onRatioChange).not.toHaveBeenCalled();
    pointerUp(window, { clientX: 600 });
    expect(onRatioChange).toHaveBeenCalledTimes(1);
    expect(onRatioChange).toHaveBeenCalledWith(0.6);
  });

  // E13 — clamps (regression guard).
  it("E13: drag toward chat clamps to 0.25, toward editor to 0.75 (on release)", async () => {
    const onRatioChange = vi.fn();
    const { container } = render(
      <SplitWorkspace mode="split" ratio={0.5} orientation="h" onRatioChange={onRatioChange} onModeChange={noop} chat={chat} editor={editor} />,
    );
    stubContainerBox(container, 0, 1000);
    const divider = screen.getByTestId("split-divider");
    pointerDown(divider, { clientX: 500 });
    pointerMove(window, { clientX: 100 });
    pointerUp(window, { clientX: 100 });
    expect(onRatioChange).toHaveBeenLastCalledWith(0.25);
    pointerDown(divider, { clientX: 500 });
    pointerMove(window, { clientX: 900 });
    pointerUp(window, { clientX: 900 });
    expect(onRatioChange).toHaveBeenLastCalledWith(0.75);
  });

  // E14 — live DOM preview, no commit yet.
  it("E14: a held move previews flex-grow on both panes without committing", async () => {
    const onRatioChange = vi.fn();
    const { container } = render(
      <SplitWorkspace mode="split" ratio={0.5} orientation="h" onRatioChange={onRatioChange} onModeChange={noop} chat={chat} editor={editor} />,
    );
    stubContainerBox(container, 0, 1000);
    pointerDown(screen.getByTestId("split-divider"), { clientX: 500 });
    pointerMove(window, { clientX: 600 });
    await nextFrame();
    expect(screen.getByTestId("split-chat-pane").style.flexGrow).toBe("0.6");
    expect(screen.getByTestId("split-editor-pane").style.flexGrow).toBe("0.4");
    expect(onRatioChange).not.toHaveBeenCalled();
  });

  // E15 — regression guard: unrelated re-render keeps the preview.
  it("E15: an identical-props re-render mid-drag keeps the previewed flex-grow", async () => {
    const props = { mode: "split" as const, ratio: 0.5, orientation: "h" as const, onRatioChange: vi.fn(), onModeChange: noop, chat, editor };
    const { container, rerender } = render(<SplitWorkspace {...props} />);
    stubContainerBox(container, 0, 1000);
    pointerDown(screen.getByTestId("split-divider"), { clientX: 500 });
    pointerMove(window, { clientX: 600 });
    await nextFrame();
    rerender(<SplitWorkspace {...props} />);
    expect(screen.getByTestId("split-chat-pane").style.flexGrow).toBe("0.6");
  });

  // E16 — regression guard: click without movement.
  it("E16: press + release without movement does not commit", () => {
    const onRatioChange = vi.fn();
    render(
      <SplitWorkspace mode="split" ratio={0.5} orientation="h" onRatioChange={onRatioChange} onModeChange={noop} chat={chat} editor={editor} />,
    );
    const divider = screen.getByTestId("split-divider");
    pointerDown(divider, { clientX: 500 });
    pointerUp(window, { clientX: 500 });
    expect(onRatioChange).not.toHaveBeenCalled();
  });

  // E17 — persisted once per drag.
  it("E17: a 5-frame drag writes the split ratio to localStorage exactly once", async () => {
    function Harness() {
      const [split, update] = useSplitState("s1", "split");
      return (
        <SplitWorkspace mode={split.mode} ratio={split.ratio} orientation="h" onRatioChange={(ratio) => update({ ratio })} onModeChange={noop} chat={chat} editor={editor} />
      );
    }
    const { container } = render(<Harness />);
    stubContainerBox(container, 0, 1000);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    try {
      pointerDown(screen.getByTestId("split-divider"), { clientX: 500 });
      for (const x of [520, 540, 560, 580, 600]) {
        pointerMove(window, { clientX: x });
        await nextFrame();
      }
      pointerUp(window, { clientX: 600 });
      const writes = setItem.mock.calls.filter(([k]) => k === "pi-dashboard:split:s1");
      expect(writes).toHaveLength(1);
      expect(JSON.parse(String(writes[0][1])).ratio).toBe(0.6);
    } finally {
      setItem.mockRestore();
    }
  });

  it("full: editor pane + leading chat restore tab; chat stays mounted but hidden", () => {
    render(
      <SplitWorkspace mode="full" ratio={0.5} orientation="h" onRatioChange={vi.fn()} onModeChange={noop} chat={chat} editor={editor} />,
    );
    expect(screen.getByTestId("editor")).toBeTruthy();
    expect(screen.getByTestId("chat-peek")).toBeTruthy();
    const chatPane = screen.getByTestId("split-chat-pane");
    expect(chatPane.className).toContain("hidden");
    expect(screen.getByTestId("chat")).toBeTruthy();
  });

  it("full: chat restore tab restores split", () => {
    const onModeChange = vi.fn();
    render(
      <SplitWorkspace mode="full" ratio={0.5} orientation="h" onRatioChange={vi.fn()} onModeChange={onModeChange} chat={chat} editor={editor} />,
    );
    fireEvent.click(screen.getByTestId("chat-peek"));
    expect(onModeChange).toHaveBeenCalledWith("split");
  });

  it("uses a horizontal (col-resize) divider on desktop", () => {
    render(
      <SplitWorkspace mode="split" ratio={0.5} orientation="h" onRatioChange={vi.fn()} onModeChange={noop} chat={chat} editor={editor} />,
    );
    const divider = screen.getByTestId("split-divider");
    expect(divider.getAttribute("aria-orientation")).toBe("vertical");
  });

  it("stacks vertically with a row-resize divider on mobile; keeps the edge-grabber peek", () => {
    const { container, rerender } = render(
      <SplitWorkspace mode="split" ratio={0.5} orientation="v" onRatioChange={vi.fn()} onModeChange={noop} chat={chat} editor={editor} />,
    );
    const divider = screen.getByTestId("split-divider");
    expect(divider.getAttribute("aria-orientation")).toBe("horizontal");
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("flex-col");
    // Mobile keeps the existing edge-grabber peek (no desktop rotated tab).
    expect(screen.queryByTestId("pane-caption-chat")).toBeNull();
  });

  it("F8: mobile stacked keeps the edge-grabber peek that restores split (both sides)", () => {
    const onModeChange = vi.fn();
    const { rerender } = render(
      <SplitWorkspace mode="closed" ratio={0.5} orientation="v" onRatioChange={vi.fn()} onModeChange={onModeChange} chat={chat} editor={editor} />,
    );
    // Closed → bottom-edge editor grabber restores split.
    const editorPeek = screen.getByTestId("editor-peek");
    expect(editorPeek.className).toContain("absolute");
    fireEvent.click(editorPeek);
    expect(onModeChange).toHaveBeenLastCalledWith("split");
    // Full → leading chat grabber restores split.
    rerender(
      <SplitWorkspace mode="full" ratio={0.5} orientation="v" onRatioChange={vi.fn()} onModeChange={onModeChange} chat={chat} editor={editor} />,
    );
    const chatPeek = screen.getByTestId("chat-peek");
    expect(chatPeek.className).toContain("absolute");
    fireEvent.click(chatPeek);
    expect(onModeChange).toHaveBeenLastCalledWith("split");
  });

  it("reflects the ratio as flex-grow on the two panes", () => {
    render(
      <SplitWorkspace mode="split" ratio={0.6} orientation="h" onRatioChange={vi.fn()} onModeChange={noop} chat={chat} editor={editor} />,
    );
    const chatPane = screen.getByTestId("split-chat-pane");
    const editorPane = screen.getByTestId("split-editor-pane");
    expect(Number(chatPane.style.flexGrow)).toBeCloseTo(0.6);
    expect(Number(editorPane.style.flexGrow)).toBeCloseTo(0.4);
  });

  // E11 — focus preserved: the compat mousedown is default-prevented.
  it("E11: mousedown on the divider is default-prevented (keeps editing focus)", () => {
    render(<SplitDivider orientation="h" onResize={() => {}} data-testid="d" />);
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      screen.getByTestId("d").dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
  });

  // E18 — touch drag is not taken over by panning.
  it("E18: the divider sets touch-action:none in both orientations", () => {
    const { rerender } = render(<SplitDivider orientation="h" onResize={() => {}} data-testid="d" />);
    expect(screen.getByTestId("d").style.touchAction).toBe("none");
    rerender(<SplitDivider orientation="v" onResize={() => {}} data-testid="d" />);
    expect(screen.getByTestId("d").style.touchAction).toBe("none");
  });
});
