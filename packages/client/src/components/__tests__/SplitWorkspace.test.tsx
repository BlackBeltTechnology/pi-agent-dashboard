import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SplitWorkspace } from "../SplitWorkspace.js";

afterEach(() => cleanup());

const chat = <div data-testid="chat">chat</div>;
const editor = <div data-testid="editor">editor</div>;

const noop = () => {};

describe("SplitWorkspace", () => {
  it("closed: chat + right-edge editor peek, no editor pane, no divider", () => {
    render(
      <SplitWorkspace mode="closed" ratio={0.5} orientation="h" onRatioChange={vi.fn()} onModeChange={noop} chat={chat} editor={editor} />,
    );
    expect(screen.getByTestId("chat")).toBeTruthy();
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(screen.queryByTestId("split-divider")).toBeNull();
    expect(screen.getByTestId("editor-peek")).toBeTruthy();
  });

  it("closed: editor peek reopens split (F7)", () => {
    const onModeChange = vi.fn();
    render(
      <SplitWorkspace mode="closed" ratio={0.5} orientation="h" onRatioChange={vi.fn()} onModeChange={onModeChange} chat={chat} editor={editor} />,
    );
    fireEvent.click(screen.getByTestId("editor-peek"));
    expect(onModeChange).toHaveBeenCalledWith("split");
  });

  it("split: renders chat + divider + editor (F1)", () => {
    render(
      <SplitWorkspace mode="split" ratio={0.5} orientation="h" onRatioChange={vi.fn()} onModeChange={noop} chat={chat} editor={editor} />,
    );
    expect(screen.getByTestId("chat")).toBeTruthy();
    expect(screen.getByTestId("editor")).toBeTruthy();
    expect(screen.getByTestId("split-divider")).toBeTruthy();
  });

  it("split: chevrons collapse to full (‹) and closed (›) (F4/F5)", () => {
    const onModeChange = vi.fn();
    render(
      <SplitWorkspace mode="split" ratio={0.5} orientation="h" onRatioChange={vi.fn()} onModeChange={onModeChange} chat={chat} editor={editor} />,
    );
    fireEvent.click(screen.getByTestId("split-fold-chat"));
    expect(onModeChange).toHaveBeenLastCalledWith("full");
    fireEvent.click(screen.getByTestId("split-fold-editor"));
    expect(onModeChange).toHaveBeenLastCalledWith("closed");
  });

  it("full: editor pane + leading chat peek; chat stays mounted but hidden (F2)", () => {
    render(
      <SplitWorkspace mode="full" ratio={0.5} orientation="h" onRatioChange={vi.fn()} onModeChange={noop} chat={chat} editor={editor} />,
    );
    expect(screen.getByTestId("editor")).toBeTruthy();
    expect(screen.getByTestId("chat-peek")).toBeTruthy();
    // Chat pane is mounted (draft/scroll survive) but the wrapper is hidden.
    const chatPane = screen.getByTestId("split-chat-pane");
    expect(chatPane.className).toContain("hidden");
    expect(screen.getByTestId("chat")).toBeTruthy();
  });

  it("full: chat peek restores split (F8)", () => {
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

  it("stacks vertically with a row-resize divider on mobile", () => {
    const { container } = render(
      <SplitWorkspace mode="split" ratio={0.5} orientation="v" onRatioChange={vi.fn()} onModeChange={noop} chat={chat} editor={editor} />,
    );
    const divider = screen.getByTestId("split-divider");
    expect(divider.getAttribute("aria-orientation")).toBe("horizontal");
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("flex-col");
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
