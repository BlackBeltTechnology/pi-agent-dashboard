/**
 * @structural-pin ToolCallStep.tsx must carry no hard-coded tool-name literal for Agent (the claim's `expandWhileRunning` decides); the absence of a literal is only observable in the source text
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bumpSlotClaimsVersion } from "@blackbelt-technology/dashboard-plugin-runtime";
import { type ClaimEntry, createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { DemoToolRenderer } from "@blackbelt-technology/demo-plugin";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ToolCallStep } from "../chat/ToolCallStep.js";
import { FORCE_STOP_ARM_MS, type StopController } from "../chat/ToolStopControl.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import { registerToolRenderer, type ToolContext } from "../tool-renderers/index.js";
import type { ToolRenderer } from "../tool-renderers/types.js";

const defaultContext: ToolContext = {};

// Mock useMobile so ToolCallStep (via EditToolRenderer → RichDiff) always runs in
// desktop mode for the lazy-mount tests below. Hoisted before any imports of the
// module under test.
let mockIsMobileForToolCallStep = false;
vi.mock("../../hooks/useMobile.js", () => ({
  useMobile: () => mockIsMobileForToolCallStep,
  MobileProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock RichDiff with a stable testid so the lazy-mount tests can query it.
vi.mock("../diff/RichDiff.js", () => ({
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

  it("hides the leading status glyph when hideStatusIcon is set (and shows it by default)", () => {
    const base = {
      toolName: "bash",
      toolCallId: "tc-hide",
      args: { command: "echo hi" },
      status: "complete" as const,
      result: "hi",
    };
    const shown = renderStep(base);
    const hidden = renderStep({ ...base, hideStatusIcon: true });
    const headerIcons = (c: HTMLElement) => c.querySelectorAll("button svg").length;
    // hideStatusIcon removes exactly the leading status glyph; chevron etc. stay.
    expect(headerIcons(hidden.container)).toBe(headerIcons(shown.container) - 1);
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

  // Fix B: live auto-expand. The card mounts at tool_execution_start WITHOUT
  // images, then images arrive at tool_execution_end. The useState seed misses
  // them; a one-shot effect must expand when images first appear.
  // See change: inline-agent-screenshot-artifacts.
  it("auto-expands when images arrive AFTER mount (live tool_execution_end)", () => {
    const base = {
      toolName: "bash",
      toolCallId: "tc-live-img",
      args: { command: "agent-browser screenshot --full" },
      context: defaultContext,
    } as const;
    const { container, rerender } = render(
      <ThemeProvider>
        <ToolCallStep {...base} status="running" />
      </ThemeProvider>,
    );
    // No images at mount → collapsed → no <img>.
    expect(container.querySelector("img")).toBeNull();

    // Images arrive at completion → effect auto-expands → <img> renders.
    rerender(
      <ThemeProvider>
        <ToolCallStep
          {...base}
          status="complete"
          result="Screenshot saved: "
          images={[{ data: "c2hvdA==", mimeType: "image/png" }]}
        />
      </ThemeProvider>,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toContain("data:image/png;base64,c2hvdA==");
  });

  // Fix B: a non-Read tool (bash/browser screenshot) carrying an inlined image
  // block renders an inline <img>, auto-expanded, with no path-link.
  // See change: inline-agent-screenshot-artifacts.
  it("renders an inline image for a bash screenshot result, auto-expanded, no path-link", () => {
    const { container } = renderStep({
      toolName: "bash",
      toolCallId: "tc-shot-1",
      args: { command: "agent-browser screenshot --full" },
      status: "complete",
      // Path was consumed by the bridge inliner → only neutral text remains.
      result: "Screenshot saved: ",
      images: [{ data: "c2hvdA==", mimeType: "image/png" }],
    });

    // Auto-expanded → inline <img> visible without clicking.
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toContain("data:image/png;base64,c2hvdA==");

    // No dead path-link rendered for the consumed screenshot path.
    expect(container.querySelector("a[href*='.png']")).toBeNull();
    expect(container.textContent).not.toContain(".png");
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

    // The thumbnail is wrapped in a keyboard-accessible button (a11y);
    // clicking it (or the img inside it) opens the lightbox.
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    const trigger = img!.closest("button");
    expect(trigger).not.toBeNull();
    expect(trigger!.className).toContain("cursor-pointer");
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

// ── Claim fields + prop contract (decouple-plugins-from-core, test-plan #E38/#E39/#E40) ──

describe("ToolCallStep claim-driven behaviour", () => {
  afterEach(cleanup);

  const stubClaim = (toolName: string, extra: Partial<ClaimEntry> = {}): ClaimEntry => ({
    pluginId: "p",
    priority: 100,
    slot: "tool-renderer",
    toolName,
    Component: () => <div data-testid="plugin-renderer">PLUGIN</div>,
    ...extra,
  });

  function mount(registry: ReturnType<typeof createSlotRegistry> | null, props: Partial<React.ComponentProps<typeof ToolCallStep>>) {
    const step = (
      <ThemeProvider>
        <ToolCallStep toolName="bash" toolCallId="tc-x" status="complete" context={defaultContext} {...props} />
      </ThemeProvider>
    );
    return render(registry ? <PluginContextProvider registry={registry}>{step}</PluginContextProvider> : step);
  }
  const isExpanded = (c: HTMLElement) => c.querySelector(".overflow-x-auto") !== null;

  // #E38 — auto-expand while running comes from the claim, not a tool-name literal.
  describe("#E38 expandWhileRunning (Agent rows with / without the plugin)", () => {
    it("claim.expandWhileRunning + running (live) → expanded", () => {
      const registry = createSlotRegistry();
      registry.addClaim(stubClaim("Agent", { expandWhileRunning: true }));
      expect(isExpanded(mount(registry, { toolName: "Agent", status: "running" }).container)).toBe(true);
    });

    it("claim.expandWhileRunning + complete (replay) → collapsed", () => {
      const registry = createSlotRegistry();
      registry.addClaim(stubClaim("Agent", { expandWhileRunning: true }));
      expect(isExpanded(mount(registry, { toolName: "Agent", status: "complete" }).container)).toBe(false);
    });

    it("plugin disabled + running → collapsed, and expanding it shows the GenericToolRenderer", () => {
      const registry = createSlotRegistry();
      registry.addClaim(stubClaim("Agent", { expandWhileRunning: true }));
      registry.setEnabledSet(new Set()); // plugin "p" disabled
      const view = mount(registry, { toolName: "Agent", status: "running", args: { subagent_type: "Explore" } });
      expect(isExpanded(view.container)).toBe(false);
      fireEvent.click(view.container.querySelector("button")!);
      expect(view.queryByTestId("plugin-renderer")).toBeNull();
      expect(view.container.querySelector("pre")?.textContent).toContain("Explore"); // Generic: raw JSON args
    });

    it("plugin re-enabled while the row is running → expands once; a user collapse afterwards sticks (F5)", () => {
      const registry = createSlotRegistry();
      registry.addClaim(stubClaim("Agent", { expandWhileRunning: true }));
      registry.setEnabledSet(new Set()); // disabled at mount → collapsed
      const view = mount(registry, { toolName: "Agent", status: "running" });
      expect(isExpanded(view.container)).toBe(false);
      act(() => {
        registry.setEnabledSet(new Set(["p"]));
        bumpSlotClaimsVersion();
      });
      expect(isExpanded(view.container)).toBe(true);
      fireEvent.click(view.container.querySelector("button")!); // user collapses
      expect(isExpanded(view.container)).toBe(false);
      act(() => bumpSlotClaimsVersion());
      expect(isExpanded(view.container)).toBe(false);
    });

    it("a claim without expandWhileRunning stays collapsed while running", () => {
      const registry = createSlotRegistry();
      registry.addClaim(stubClaim("Agent"));
      expect(isExpanded(mount(registry, { toolName: "Agent", status: "running" }).container)).toBe(false);
    });

    it("the collapsed Agent summary is identical with the plugin claim present and absent (E37)", () => {
      const args = { subagent_type: "Explore", description: "Fix auth bug" };
      const withPlugin = createSlotRegistry();
      withPlugin.addClaim(stubClaim("Agent", { expandWhileRunning: true }));
      const on = mount(withPlugin, { toolName: "Agent", status: "complete", args }).container.querySelector("button")!.textContent;
      cleanup();
      const off = mount(createSlotRegistry(), { toolName: "Agent", status: "complete", args }).container.querySelector("button")!.textContent;
      expect(on).toContain("Explore: Fix auth bug");
      expect(on).toBe(off);
    });

    it("no tool-name literal for Agent remains in ToolCallStep.tsx", () => {
      const src = readFileSync(resolve(__dirname, "../chat/ToolCallStep.tsx"), "utf8");
      expect(src).not.toMatch(/["'`]Agent["'`]/);
    });
  });

  // #E39 — dispatch chain over the extra decision rows (3.1–3.8 above cover the rest).
  describe("#E39 tool-renderer dispatch chain", () => {
    function expand(view: ReturnType<typeof render>) {
      fireEvent.click(view.container.querySelector("button")!);
      return view;
    }

    it("bash claim → plugin renderer wins over the built-in Bash", () => {
      const registry = createSlotRegistry();
      registry.addClaim(stubClaim("bash"));
      expect(expand(mount(registry, { toolName: "bash", args: { command: "ls" } })).queryByTestId("plugin-renderer")).not.toBeNull();
    });

    it("unclaimed unknown tool → GenericToolRenderer (raw JSON args)", () => {
      const view = expand(mount(createSlotRegistry(), { toolName: "totally_unknown_tool", args: { marker: "RAW_ARGS" } }));
      expect(view.queryByTestId("plugin-renderer")).toBeNull();
      expect(view.container.querySelector("pre")?.textContent).toContain("RAW_ARGS");
    });

    it("ctx_execute: unclaimed → built-in; claim shouldRender:false → built-in again", () => {
      const unclaimed = expand(mount(createSlotRegistry(), { toolName: "ctx_execute", args: { language: "shell", code: "echo hi" } }));
      expect(unclaimed.queryByTestId("plugin-renderer")).toBeNull();
      cleanup();
      const registry = createSlotRegistry();
      registry.addClaim(stubClaim("ctx_execute", { shouldRender: () => false }));
      const gated = expand(mount(registry, { toolName: "ctx_execute", args: { language: "shell", code: "echo hi" } }));
      expect(gated.queryByTestId("plugin-renderer")).toBeNull();
    });
  });

  // #E40 — prop contract: legacy claims keep working; result/status mirror the built-in props;
  // `context.send` is the SAME sender reference the built-in renderer receives.
  describe("#E40 tool-renderer prop contract", () => {
    it("a legacy claim reading only toolName/toolInput/sessionId renders without error", () => {
      const registry = createSlotRegistry();
      const seen: Record<string, unknown> = {};
      registry.addClaim(
        stubClaim("legacy", {
          Component: ((p: { toolName: string; toolInput: unknown; sessionId: string }) => {
            Object.assign(seen, { toolName: p.toolName, toolInput: p.toolInput, sessionId: p.sessionId });
            return <div data-testid="plugin-renderer" />;
          }) as ClaimEntry["Component"],
        }),
      );
      const view = mount(registry, { toolName: "legacy", args: { a: 1 }, context: { sessionId: "s-1" } });
      fireEvent.click(view.container.querySelector("button")!);
      expect(view.queryByTestId("plugin-renderer")).not.toBeNull();
      expect(seen).toEqual({ toolName: "legacy", toolInput: { a: 1 }, sessionId: "s-1" });
    });

    it("a claim receives result/status equal to the built-in props", () => {
      const registry = createSlotRegistry();
      let got: { result?: string; status?: string } = {};
      registry.addClaim(
        stubClaim("legacy", {
          Component: ((p: { result?: string; status?: string }) => {
            got = { result: p.result, status: p.status };
            return <div data-testid="plugin-renderer" />;
          }) as ClaimEntry["Component"],
        }),
      );
      const view = mount(registry, { toolName: "legacy", status: "error", result: "boom body" });
      fireEvent.click(view.container.querySelector("button")!);
      expect(got).toEqual({ result: "boom body", status: "error" });
    });

    it("context.send is the same reference for a plugin renderer and the built-in renderer", () => {
      const send = vi.fn();
      let builtInSend: unknown;
      registerToolRenderer("send_probe", ((p: { context: ToolContext }) => {
        builtInSend = p.context.send;
        return <div data-testid="builtin-renderer" />;
      }) as unknown as ToolRenderer);
      const builtIn = mount(null, { toolName: "send_probe", context: { sessionId: "s-1", send } as ToolContext });
      fireEvent.click(builtIn.container.querySelector("button")!);
      expect(builtInSend).toBe(send);
      cleanup();

      const registry = createSlotRegistry();
      let pluginSend: unknown;
      registry.addClaim(
        stubClaim("send_probe", {
          Component: ((p: { context?: { send?: unknown } }) => {
            pluginSend = p.context?.send;
            return <div data-testid="plugin-renderer" />;
          }) as ClaimEntry["Component"],
        }),
      );
      const plugin = mount(registry, { toolName: "send_probe", context: { sessionId: "s-1", send } as ToolContext });
      fireEvent.click(plugin.container.querySelector("button")!);
      expect(pluginSend).toBe(send);
      expect(pluginSend).toBe(builtInSend);
    });
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

  it("calls onAbort, arms, then escalates to force-stop (#F12)", () => {
    vi.useFakeTimers();
    try {
      const onAbort = vi.fn();
      const onForceKill = vi.fn();
      const { container } = renderStep({ status: "running", onAbort, onForceKill });
      const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;

      fireEvent.click(q("tool-stop-button")!);
      expect(onAbort).toHaveBeenCalledOnce();
      expect(q("tool-arming-button")!.disabled).toBe(true);

      act(() => vi.advanceTimersByTime(FORCE_STOP_ARM_MS));
      fireEvent.click(q("tool-force-stop-button")!);
      expect(onForceKill).toHaveBeenCalledOnce();
      expect(q("tool-killing-button")!.disabled).toBe(true);
      // Neither click toggled the row open (bash has no auto-expand).
      expect(container.querySelector(".mt-1.ml-4")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("burst stopController wins over own handlers (#F13)", () => {
    const onAbort = vi.fn();
    const controller: StopController = { state: "aborting", stop: vi.fn(), forceKill: vi.fn() };
    const { container } = renderStep({ status: "running", onAbort, stopController: controller });
    expect(container.querySelector('[data-testid="tool-force-stop-button"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tool-stop-button"]')).toBeNull();
    expect(onAbort).not.toHaveBeenCalled();
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
  it("6.2 Clicking expand chevron mounts <RichDiff>", async () => {
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
    // RichDiff is a lazy boundary now (change: add-lazy-terminal-diff-bootstrap)
    // — it mounts a microtask after the expand, behind its local Suspense.
    await waitFor(() =>
      expect(container.querySelector('[data-testid="rich-diff"]')).not.toBeNull(),
    );
  });

  it("renders the 'recovered' badge when the row was healed by supersede", () => {
    const { container } = renderStep({
      status: "complete",
      toolDetails: { healedBy: "superseded" },
    });
    expect(container.querySelector('[data-testid="tool-superseded-badge"]')).not.toBeNull();
  });

  // See change: distinguish-tool-result-pending-vs-gone (test-plan E22).
  it("renders a distinct eviction badge when the row was finalized by a server-vouched eviction", () => {
    const { container } = renderStep({
      status: "complete",
      toolDetails: { healedBy: "result_evicted" },
    });
    const badge = container.querySelector('[data-testid="tool-evicted-badge"]');
    expect(badge).not.toBeNull();
    expect(container.querySelector('[data-testid="tool-superseded-badge"]')).toBeNull();
    const superseded = renderStep({ status: "complete", toolDetails: { healedBy: "superseded" } });
    const supersededText = superseded.container.querySelector('[data-testid="tool-superseded-badge"]')?.textContent;
    expect(badge?.textContent).toBeTruthy();
    expect(badge?.textContent).not.toBe(supersededText);
  });

  // See change: finalize-agent-card-on-subagent-stop (test-plan F9, D6). The badge
  // CONDITION is the subagents plugin's `resultPending` predicate (tested in the
  // plugin); here the shell contract: it shows exactly when the claim's predicate
  // says so, receives (toolDetails, context.session), and never without a claim.
  describe("recovered badge is driven by the claim's resultPending predicate (F9, D5 item 7)", () => {
    const session = { subagents: new Map() };
    function renderWithClaim(claim: Partial<ClaimEntry> | null, toolDetails: Record<string, unknown>) {
      const registry = createSlotRegistry();
      if (claim) {
        registry.addClaim({
          pluginId: "p",
          priority: 100,
          slot: "tool-renderer",
          toolName: "Agent",
          Component: () => <div data-testid="plugin-renderer" />,
          ...claim,
        });
      }
      return render(
        <PluginContextProvider registry={registry}>
          <ThemeProvider>
            <ToolCallStep
              toolName="Agent"
              toolCallId="tc-1"
              status="complete"
              toolDetails={toolDetails}
              context={{ session } as unknown as ToolContext}
            />
          </ThemeProvider>
        </PluginContextProvider>,
      );
    }
    const badge = (c: HTMLElement) => c.querySelector('[data-testid="tool-recovered-badge"]');

    it("shows the badge when the predicate is true and passes (toolDetails, context.session)", () => {
      const resultPending = vi.fn(() => true);
      const { container } = renderWithClaim({ resultPending }, { healedBy: "session_ended", agentId: "ag" });
      expect(badge(container)).not.toBeNull();
      expect(resultPending).toHaveBeenCalledWith({ healedBy: "session_ended", agentId: "ag" }, session);
      expect(container.querySelector('[data-testid="tool-superseded-badge"]')).toBeNull();
    });

    it("hides the badge when the predicate is false", () => {
      const { container } = renderWithClaim({ resultPending: () => false }, { healedBy: "session_ended" });
      expect(badge(container)).toBeNull();
    });

    it("hides the badge when no claim (plugin absent/disabled) or the claim has no predicate", () => {
      expect(badge(renderWithClaim(null, { healedBy: "session_ended" }).container)).toBeNull();
      expect(badge(renderWithClaim({}, { healedBy: "session_ended" }).container)).toBeNull();
    });

    it("a throwing predicate fails closed with a warning naming plugin and tool", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { container } = renderWithClaim(
        { resultPending: () => { throw new Error("pending boom"); } },
        { healedBy: "session_ended" },
      );
      expect(badge(container)).toBeNull();
      expect(warnSpy.mock.calls.some((c) => c.join(" ").includes('"p"') && c.join(" ").includes("Agent"))).toBe(true);
      warnSpy.mockRestore();
    });
  });

  it("omits the 'recovered' badge for a normal completion", () => {
    const { container } = renderStep({ status: "complete" });
    expect(container.querySelector('[data-testid="tool-superseded-badge"]')).toBeNull();
  });

  // #F4 (repair-tool-error-surfaces) — the errored status icon is a single-line
  // surface. Only the error branch is governed; the sibling branches are a
  // different tier and are pinned unchanged.
  it("#F4 the errored status icon resolves its colour from --severity-error-fg", () => {
    const { container } = renderStep({ status: "error" });
    const icon = container.querySelector("span.inline-flex") as HTMLElement;
    expect(icon.className).toContain("text-[var(--severity-error-fg)]");
    expect(icon.className).not.toMatch(/\bred-\d{2,3}\b/);
  });

  it("leaves the non-error status branches untouched by this change", () => {
    const { container } = renderStep({ status: "complete" });
    expect((container.querySelector("span.inline-flex") as HTMLElement).className).toContain("text-green-400");
  });
});

// ── Late tool renderer (runtime plugin registers after the row mounted) ──────
// test-plan #E89. See change: decouple-plugins-from-core (task 6.16).
describe("ToolCallStep late tool-renderer claim", () => {
  afterEach(cleanup);

  it("replaces Generic after addClaim + bump; a re-render without a bump reuses the lookup", () => {
    const registry = createSlotRegistry();
    const getClaims = vi.spyOn(registry, "getClaims");
    const toolRendererLookups = () => getClaims.mock.calls.filter((c) => c[0] === "tool-renderer").length;
    const view = (result: string) => (
      <PluginContextProvider registry={registry}>
        <ThemeProvider>
          <ToolCallStep toolName="quota_check" toolCallId="tc-late" status="complete" result={result} context={defaultContext} />
        </ThemeProvider>
      </PluginContextProvider>
    );
    const { container, queryByTestId, rerender } = render(view("r1"));
    fireEvent.click(container.querySelector("button")!);
    expect(queryByTestId("late-renderer")).toBeNull();
    const before = toolRendererLookups();

    act(() => {
      registry.addClaim({
        pluginId: "quota-ui",
        priority: 100,
        slot: "tool-renderer",
        toolName: "quota_check",
        Component: () => <div data-testid="late-renderer">LATE</div>,
      } as ClaimEntry);
      bumpSlotClaimsVersion();
    });
    expect(queryByTestId("late-renderer")).not.toBeNull();
    const afterBump = toolRendererLookups();
    expect(afterBump).toBe(before + 1);

    // result update, no bump → memo reused, no new lookup
    rerender(view("r2"));
    expect(toolRendererLookups()).toBe(afterBump);
  });
});
