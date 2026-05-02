import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import { ToolCallStep } from "../ToolCallStep.js";
import { ThemeProvider } from "../ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

const defaultContext: ToolContext = { editors: [] };

// Mock useMobile so ToolCallStep (via EditToolRenderer → RichDiff) always runs in
// desktop mode for the lazy-mount tests below. Hoisted before any imports of the
// module under test.
let mockIsMobileForToolCallStep = false;
vi.mock("../../hooks/useMobile.js", () => ({
  useMobile: () => mockIsMobileForToolCallStep,
  MobileProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock RichDiff with a stable testid so the lazy-mount tests can query it.
vi.mock("../RichDiff.js", () => ({
  RichDiff: () => <div data-testid="rich-diff" />,
}));

// Mock @git-diff-view CSS import that RichDiff pulls in.
vi.mock("@git-diff-view/react/styles/diff-view.css", () => ({}));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

function renderStep(props: Partial<React.ComponentProps<typeof ToolCallStep>> = {}) {
  return render(
    <ThemeProvider>
      <ToolCallStep
        toolName="bash"
        toolCallId="tc-1"
        status="complete"
        context={defaultContext}
        {...props}
      />
    </ThemeProvider>,
  );
}

describe("ToolCallStep", () => {
  it("renders ask_user as a standard collapsible tool step, not an InteractiveRenderer", () => {
    const { container, getByText } = renderStep({
      toolName: "ask_user",
      toolCallId: "tc-ask-1",
      args: { method: "confirm", title: "Are you sure?" },
      status: "complete",
      result: 'User responded: true',
    });

    // Should render the summary button (collapsible tool step)
    const button = container.querySelector("button");
    expect(button).toBeTruthy();
    expect(button!.textContent).toContain("Are you sure?");

    // Should NOT render an interactive renderer (no confirm/select UI)
    // InteractiveRenderers have data-testid or specific class patterns
    // The collapsible step has a chevron icon and border-l-2 wrapper
    expect(container.querySelector("[data-testid='confirm-renderer']")).toBeNull();
    expect(container.querySelector("[data-testid='select-renderer']")).toBeNull();
  });

  it("renders ask_user summary with title from args", () => {
    const { container } = renderStep({
      toolName: "ask_user",
      toolCallId: "tc-ask-2",
      args: { method: "select", title: "Pick a color", options: ["red", "blue"] },
      status: "running",
    });

    const button = container.querySelector("button");
    expect(button!.textContent).toContain("Pick a color");
  });

  it("renders non-ask_user tools normally", () => {
    const { container } = renderStep({
      toolName: "bash",
      toolCallId: "tc-bash-1",
      args: { command: "echo hello" },
      status: "complete",
      result: "hello",
    });

    const button = container.querySelector("button");
    expect(button!.textContent).toContain("echo hello");
  });

  it("auto-expands when images are present", () => {
    const { container } = renderStep({
      toolName: "read",
      toolCallId: "tc-img-1",
      args: { path: "photo.png" },
      status: "complete",
      result: "Read image file [image/png]",
      images: [{ data: "iVBORw0KGgo=", mimeType: "image/png" }],
    });

    // Should be expanded by default — renderer content should be visible
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toContain("data:image/png;base64,iVBORw0KGgo=");
  });

  it("stays collapsed when no images", () => {
    const { container } = renderStep({
      toolName: "read",
      toolCallId: "tc-txt-1",
      args: { path: "file.ts" },
      status: "complete",
      result: "const x = 1;",
    });

    // Should be collapsed — no img or code block visible
    const img = container.querySelector("img");
    expect(img).toBeNull();
  });

  it("renders image in ReadToolRenderer when expanded", () => {
    const { container } = renderStep({
      toolName: "read",
      toolCallId: "tc-img-2",
      args: { path: "screenshot.jpg" },
      status: "complete",
      result: "Read image file [image/jpeg]",
      images: [{ data: "abc123", mimeType: "image/jpeg" }],
    });

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("alt")).toBe("screenshot.jpg");
    expect(img!.className).toContain("max-w-[512px]");
  });

  describe("ask_user auto-expand behavior", () => {
    // A lightweight way to detect expanded state: the renderer content wrapper
    // (.overflow-x-auto on the inner div) only renders when expanded.
    function isExpanded(container: HTMLElement): boolean {
      return container.querySelector(".overflow-x-auto") !== null;
    }

    it("auto-expands ask_user when status is running (pending dialog)", () => {
      const { container } = renderStep({
        toolName: "ask_user",
        toolCallId: "tc-run",
        args: { method: "confirm", title: "Proceed?" },
        status: "running",
      });
      expect(isExpanded(container)).toBe(true);
    });

    it("auto-expands ask_user when status is complete (answer visible)", () => {
      const { container } = renderStep({
        toolName: "ask_user",
        toolCallId: "tc-ok",
        args: { method: "confirm", title: "Proceed?" },
        status: "complete",
        result: "User responded: true",
      });
      expect(isExpanded(container)).toBe(true);
    });

    it("does NOT auto-expand ask_user when status is error", () => {
      const { container } = renderStep({
        toolName: "ask_user",
        toolCallId: "tc-err",
        args: { method: "multiselect", title: "Pick" },
        status: "error",
        result: "ctx.ui.multiselect is not a function",
      });
      expect(isExpanded(container)).toBe(false);
    });

    it("clicking a collapsed failed ask_user expands it", () => {
      const { container } = renderStep({
        toolName: "ask_user",
        toolCallId: "tc-err-click",
        args: { method: "multiselect", title: "Pick" },
        status: "error",
        result: "Some error",
      });
      expect(isExpanded(container)).toBe(false);
      fireEvent.click(container.querySelector("button")!);
      expect(isExpanded(container)).toBe(true);
    });
  });

  it("opens lightbox when clicking a tool result image", () => {
    const { container } = renderStep({
      toolName: "read",
      toolCallId: "tc-img-lb",
      args: { path: "photo.png" },
      status: "complete",
      result: "Read image file [image/png]",
      images: [{ data: "iVBORw0KGgo=", mimeType: "image/png" }],
    });

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.className).toContain("cursor-pointer");
    fireEvent.click(img!);
    const lightbox = document.body.querySelector("[data-testid='lightbox-backdrop']");
    expect(lightbox).not.toBeNull();
  });
});

describe("ToolCallStep inline stop button", () => {
  it("shows stop button when running and onAbort provided", () => {
    const onAbort = vi.fn();
    const { container } = renderStep({ status: "running", onAbort });
    expect(container.querySelector('[data-testid="tool-stop-button"]')).not.toBeNull();
  });

  it("hides stop button when complete", () => {
    const onAbort = vi.fn();
    const { container } = renderStep({ status: "complete", onAbort });
    expect(container.querySelector('[data-testid="tool-stop-button"]')).toBeNull();
  });

  it("hides stop button when no onAbort", () => {
    const { container } = renderStep({ status: "running" });
    expect(container.querySelector('[data-testid="tool-stop-button"]')).toBeNull();
  });

  it("calls onAbort and escalates to force-stop on click", () => {
    const onAbort = vi.fn();
    const onForceKill = vi.fn();
    const { container } = renderStep({ status: "running", onAbort, onForceKill });

    // Click stop
    fireEvent.click(container.querySelector('[data-testid="tool-stop-button"]')!);
    expect(onAbort).toHaveBeenCalledOnce();

    // Should show force-stop button
    expect(container.querySelector('[data-testid="tool-stop-button"]')).toBeNull();
    expect(container.querySelector('[data-testid="tool-force-stop-button"]')).not.toBeNull();

    // Click force-stop
    fireEvent.click(container.querySelector('[data-testid="tool-force-stop-button"]')!);
    expect(onForceKill).toHaveBeenCalledOnce();
  });
});

describe("ToolCallStep lazy-mount — <RichDiff> only mounts when expanded", () => {
  afterEach(() => {
    mockIsMobileForToolCallStep = false;
  });

  // 6.1: Edit tool card collapsed by default → no <RichDiff> in DOM
  it("6.1 Edit card collapsed by default: no <RichDiff> in DOM", () => {
    mockIsMobileForToolCallStep = false; // desktop
    const { container } = render(
      <ThemeProvider>
        <ToolCallStep
          toolName="edit"
          toolCallId="tc-edit-collapsed"
          args={{ path: "src/foo.ts", oldText: "const a = 1;", newText: "const a = 2;" }}
          status="complete"
          context={defaultContext}
        />
      </ThemeProvider>,
    );
    // Edit cards default to collapsed — RichDiff must not be mounted
    expect(container.querySelector('[data-testid="rich-diff"]')).toBeNull();
  });

  // 6.2: After clicking the chevron, <RichDiff> appears in DOM
  it("6.2 Clicking expand chevron mounts <RichDiff>", () => {
    mockIsMobileForToolCallStep = false; // desktop
    const { container } = render(
      <ThemeProvider>
        <ToolCallStep
          toolName="edit"
          toolCallId="tc-edit-expand"
          args={{ path: "src/foo.ts", oldText: "const a = 1;", newText: "const a = 2;" }}
          status="complete"
          context={defaultContext}
        />
      </ThemeProvider>,
    );

    expect(container.querySelector('[data-testid="rich-diff"]')).toBeNull();

    // Click the summary button to expand
    fireEvent.click(container.querySelector("button")!);
    expect(container.querySelector('[data-testid="rich-diff"]')).not.toBeNull();
  });
});
