import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { ToolCallStep } from "../ToolCallStep.js";
import { ThemeProvider } from "../ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";
import { PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { createSlotRegistry, type ClaimEntry } from "@blackbelt-technology/dashboard-plugin-runtime";
import { DemoToolRenderer } from "@blackbelt-technology/demo-plugin";

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

  it("renders the full bash command in collapsed summary (no slice)", () => {
    const longCommand =
      "test -e openspec/changes/archive/2026-05-28-bump-pi-compat-to-0-75/proposal.md";
    const { container } = renderStep({
      toolName: "bash",
      toolCallId: "tc-bash-long",
      args: { command: longCommand },
      status: "complete",
    });
    const button = container.querySelector("button")!;
    expect(button.textContent).toContain(longCommand);
    expect(button.getAttribute("title")).toBe(`$ ${longCommand}`);
    // Visible truncation handled by CSS class on the summary span
    const summarySpan = button.querySelector("span.truncate");
    expect(summarySpan).not.toBeNull();
    expect(summarySpan!.textContent).toBe(`$ ${longCommand}`);
  });

  it("renders the full Agent description in collapsed summary (no slice)", () => {
    const longDesc =
      "Investigate the entire src/server directory for legacy reconnect logic and propose a rewrite";
    const { container } = renderStep({
      toolName: "Agent",
      toolCallId: "tc-agent-long",
      args: { subagent_type: "Explore", description: longDesc },
      status: "running",
    });
    const button = container.querySelector("button")!;
    expect(button.textContent).toContain(longDesc);
    expect(button.getAttribute("title")).toBe(`Explore: ${longDesc}`);
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

// ── Plugin tool-renderer dispatch (wire-tool-renderer-slot) ──────────────────

describe("ToolCallStep plugin tool-renderer dispatch", () => {
  afterEach(cleanup);

  function renderWithRegistry(
    registry: ReturnType<typeof createSlotRegistry>,
    props: Partial<React.ComponentProps<typeof ToolCallStep>>,
  ) {
    const view = render(
      <PluginContextProvider registry={registry}>
        <ThemeProvider>
          <ToolCallStep
            toolName="bash"
            toolCallId="tc-plugin"
            status="complete"
            context={defaultContext}
            {...props}
          />
        </ThemeProvider>
      </PluginContextProvider>,
    );
    // Expand the tool body so the renderer mounts.
    fireEvent.click(view.container.querySelector("button")!);
    return view;
  }

  function pluginClaim(
    toolName: string,
    extra: Partial<ClaimEntry> = {},
  ): ClaimEntry {
    return {
      pluginId: "p",
      priority: 100,
      slot: "tool-renderer",
      toolName,
      Component: () => <div data-testid="plugin-renderer">PLUGIN</div>,
      ...extra,
    };
  }

  // 3.1 plugin claim with matching toolName wins over a built-in renderer
  it("3.1 plugin claim wins over built-in for same toolName (read)", () => {
    const registry = createSlotRegistry();
    registry.addClaim(pluginClaim("read"));
    const { queryByTestId, queryByText } = renderWithRegistry(registry, {
      toolName: "read",
      args: { path: "file.ts" },
      result: "BUILTIN_RESULT_BODY",
    });
    expect(queryByTestId("plugin-renderer")).not.toBeNull();
    // Built-in ReadToolRenderer would surface the result body; plugin ignores it.
    expect(queryByText("BUILTIN_RESULT_BODY")).toBeNull();
  });

  // 3.2 no plugin claim → built-in renderer wins
  it("3.2 no plugin claim → built-in renderer renders", () => {
    const registry = createSlotRegistry();
    const { queryByTestId, getByText } = renderWithRegistry(registry, {
      toolName: "read",
      args: { path: "file.ts" },
      result: "BUILTIN_RESULT_BODY",
    });
    expect(queryByTestId("plugin-renderer")).toBeNull();
    expect(getByText("BUILTIN_RESULT_BODY")).toBeDefined();
  });

  // 3.3 plugin claim with shouldRender:false → falls through to built-in
  it("3.3 shouldRender:false falls through to built-in", () => {
    const registry = createSlotRegistry();
    registry.addClaim(pluginClaim("read", { shouldRender: () => false }));
    const { queryByTestId, getByText } = renderWithRegistry(registry, {
      toolName: "read",
      args: { path: "file.ts" },
      result: "BUILTIN_RESULT_BODY",
    });
    expect(queryByTestId("plugin-renderer")).toBeNull();
    expect(getByText("BUILTIN_RESULT_BODY")).toBeDefined();
  });

  // 3.4 plugin claim with NO built-in fallback → Generic when shouldRender:false; plugin when truthy
  it("3.4 no built-in: shouldRender:false → Generic fires (result shown)", () => {
    const registry = createSlotRegistry();
    registry.addClaim(pluginClaim("ctx_execute", { shouldRender: () => false }));
    const { queryByTestId, getByText } = renderWithRegistry(registry, {
      toolName: "ctx_execute",
      args: {},
      result: "GENERIC_OUTPUT",
    });
    expect(queryByTestId("plugin-renderer")).toBeNull();
    expect(getByText("GENERIC_OUTPUT")).toBeDefined();
  });

  it("3.4 no built-in: shouldRender truthy → plugin fires", () => {
    const registry = createSlotRegistry();
    registry.addClaim(pluginClaim("ctx_execute"));
    const { queryByTestId, queryByText } = renderWithRegistry(registry, {
      toolName: "ctx_execute",
      args: {},
      result: "GENERIC_OUTPUT",
    });
    expect(queryByTestId("plugin-renderer")).not.toBeNull();
    expect(queryByText("GENERIC_OUTPUT")).toBeNull();
  });

  // 3.5 plugin claim overriding a built-in toolName ("bash") → plugin wins
  it("3.5 plugin overriding built-in 'bash' → plugin wins", () => {
    const registry = createSlotRegistry();
    registry.addClaim(pluginClaim("bash"));
    const { queryByTestId } = renderWithRegistry(registry, {
      toolName: "bash",
      args: { command: "echo hi" },
      result: "hi",
    });
    expect(queryByTestId("plugin-renderer")).not.toBeNull();
  });

  // 3.6 plugin renderer throws → ErrorBoundary catches; no fall-through
  it("3.6 plugin renderer throws → ErrorBoundary catches, no fall-through", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const registry = createSlotRegistry();
    registry.addClaim(
      pluginClaim("read", {
        Component: () => {
          throw new Error("plugin boom");
        },
      }),
    );
    const { getByText, queryByText } = renderWithRegistry(registry, {
      toolName: "read",
      args: { path: "file.ts" },
      result: "BUILTIN_RESULT_BODY",
    });
    // ErrorBoundary fallback shows; built-in did NOT render as a fallback.
    expect(getByText(/Render error/)).toBeDefined();
    expect(queryByText("BUILTIN_RESULT_BODY")).toBeNull();
    consoleSpy.mockRestore();
  });

  // 3.7 plugin shouldRender throws → fail-closed; fall through; console warning
  it("3.7 shouldRender throws → fail-closed, falls through, warns", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = createSlotRegistry();
    registry.addClaim(
      pluginClaim("read", {
        shouldRender: () => {
          throw new Error("shouldRender boom");
        },
      }),
    );
    const { queryByTestId, getByText } = renderWithRegistry(registry, {
      toolName: "read",
      args: { path: "file.ts" },
      result: "BUILTIN_RESULT_BODY",
    });
    expect(queryByTestId("plugin-renderer")).toBeNull();
    expect(getByText("BUILTIN_RESULT_BODY")).toBeDefined();
    const warned = warnSpy.mock.calls.map((c) => c.join(" "));
    expect(warned.some((s) => s.includes("p") && s.includes("read"))).toBe(true);
    warnSpy.mockRestore();
  });

  // 3.8 no provider → useSlotRegistryOrNull null → falls through to built-in
  it("3.8 no SlotRegistryProvider → falls through to built-in", () => {
    const view = render(
      <ThemeProvider>
        <ToolCallStep
          toolName="read"
          toolCallId="tc-no-provider"
          args={{ path: "file.ts" }}
          status="complete"
          result="BUILTIN_RESULT_BODY"
          context={defaultContext}
        />
      </ThemeProvider>,
    );
    fireEvent.click(view.container.querySelector("button")!);
    expect(view.queryByTestId("plugin-renderer")).toBeNull();
    expect(view.getByText("BUILTIN_RESULT_BODY")).toBeDefined();
  });

  // 4.2 demo-plugin smoke: green box mounts for toolName DashboardDemo
  it("4.2 demo-plugin enabled → green-box renderer mounts for DashboardDemo", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "demo",
      priority: 1000,
      slot: "tool-renderer",
      toolName: "DashboardDemo",
      Component: DemoToolRenderer as ClaimEntry["Component"],
    });
    const { getByTestId } = renderWithRegistry(registry, {
      toolName: "DashboardDemo",
      args: { foo: "bar" },
      result: "ignored-by-demo",
    });
    expect(getByTestId("demo-tool-renderer")).toBeDefined();
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
