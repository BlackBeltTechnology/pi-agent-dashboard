import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SplitWorkspace } from "../split/SplitWorkspace.js";

afterEach(() => cleanup());

const chat = <div data-testid="chat">chat</div>;
const editor = <div data-testid="editor">editor</div>;

const noop = () => {};

/** Stub the split container's box so useSplitRatio maps pointer→ratio. */
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

  it("E1: dragging the divider toward chat clamps the ratio to 0.25", () => {
    const onRatioChange = vi.fn();
    const { container } = render(
      <SplitWorkspace mode="split" ratio={0.5} orientation="h" onRatioChange={onRatioChange} onModeChange={noop} chat={chat} editor={editor} />,
    );
    stubContainerBox(container, 0, 1000);
    fireEvent.mouseDown(screen.getByTestId("split-divider"));
    // Pointer at x=100 → raw fraction 0.1 → below the 0.25 floor.
    fireEvent.mouseMove(document, { clientX: 100 });
    expect(onRatioChange).toHaveBeenLastCalledWith(0.25);
  });

  it("E2: dragging the divider toward editor clamps the ratio to 0.75", () => {
    const onRatioChange = vi.fn();
    const { container } = render(
      <SplitWorkspace mode="split" ratio={0.5} orientation="h" onRatioChange={onRatioChange} onModeChange={noop} chat={chat} editor={editor} />,
    );
    stubContainerBox(container, 0, 1000);
    fireEvent.mouseDown(screen.getByTestId("split-divider"));
    // Pointer at x=900 → raw fraction 0.9 → above the 0.75 ceiling.
    fireEvent.mouseMove(document, { clientX: 900 });
    expect(onRatioChange).toHaveBeenLastCalledWith(0.75);
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
});
