/**
 * L1 — absorbed custom rows render through the shared container at BOTH
 * absorption sites (change: add-custom-entry-renderer-slot).
 *
 * Covers test-plan F3–F8: the visible case is load-bearing (without it the
 * hidden case passes vacuously), plus the third vanish path where the per-tool
 * gate empties a container that still holds a visible custom row.
 */
import { DISPLAY_PRESETS, type DisplayPrefs } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime";
import { PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../../lib/chat/event-reducer.js";
import type { ChatItem, ToolCallGroup } from "../../lib/chat/group-tool-calls.js";
import { DisplayPrefsProvider } from "../../lib/state/DisplayPrefsContext.js";
import { CollapsedToolGroup } from "../chat/CollapsedToolGroup.js";
import { ToolBurstGroup } from "../chat/ToolBurstGroup.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const toolContext: ToolContext = { sessionId: "s1" };

let seq = 0;
function tool(toolName = "edit", args: Record<string, unknown> = { path: "/a" }): ChatMessage {
  return {
    id: `t-${seq++}`,
    role: "toolResult",
    content: "",
    toolName,
    toolCallId: `tc-${seq}`,
    toolStatus: "complete",
    timestamp: 1756300000000,
    args,
    result: "",
  };
}

function custom(groupId = "memory"): ChatMessage {
  return {
    id: `c-${seq++}`,
    role: "custom",
    customType: "om.observations.recorded",
    groupId,
    content: "{}",
    timestamp: 1756300000000,
  };
}

function StubPlugin() {
  return <div data-testid="stub-plugin">claimed-renderer</div>;
}

function registry() {
  const r = createSlotRegistry();
  r.addClaim({
    pluginId: "blackhole",
    priority: 200,
    slot: "custom-entry-renderer",
    customType: "om.observations.recorded",
    Component: StubPlugin as never,
  });
  return r;
}

function prefsWith(opts: { memory?: boolean; preset?: DisplayPrefs } = {}): DisplayPrefs {
  const base = opts.preset ?? DISPLAY_PRESETS.standard;
  return {
    ...base,
    customEventGroups: { ...base.customEventGroups, memory: opts.memory ?? true },
  };
}

function wrap(node: React.ReactNode, prefs: DisplayPrefs) {
  return render(
    <ThemeProvider>
      <DisplayPrefsProvider value={{ global: prefs, getSessionOverride: () => undefined }}>
        <PluginContextProvider registry={registry()}>{node}</PluginContextProvider>
      </DisplayPrefsProvider>
    </ThemeProvider>,
  );
}

describe("ToolBurstGroup — absorbed custom rows (F3/F4/F7)", () => {
  it("F3: a claimed row absorbed into an EXPANDED burst renders via the plugin", () => {
    const { container } = wrap(
      <ToolBurstGroup
        burst={{ type: "burst", id: "b1", items: [tool(), custom(), tool()] as ChatItem[] }}
        toolContext={toolContext}
      />,
      prefsWith(),
    );
    expect(screen.queryByTestId("stub-plugin")).toBeNull();
    fireEvent.click(container.querySelector('[data-testid="tool-burst-header"]')!);
    expect(screen.getByTestId("stub-plugin")).toBeTruthy();
  });

  it("F4: a claimed row absorbed into an expanded burst renders NOTHING when its group is hidden", () => {
    const { container } = wrap(
      <ToolBurstGroup
        burst={{ type: "burst", id: "b1", items: [tool(), custom(), tool()] as ChatItem[] }}
        toolContext={toolContext}
      />,
      prefsWith({ memory: false }),
    );
    fireEvent.click(container.querySelector('[data-testid="tool-burst-header"]')!);
    expect(screen.queryByTestId("stub-plugin")).toBeNull();
  });

  it("F7: a custom row survives a burst whose tool members are all hidden by prefs.toolCalls", () => {
    const { container } = wrap(
      <ToolBurstGroup
        burst={{ type: "burst", id: "b1", items: [custom(), tool("bash")] as ChatItem[] }}
        toolContext={toolContext}
      />,
      prefsWith({ preset: DISPLAY_PRESETS.simple }),
    );
    // No header (every tool member gated off), yet the custom row renders.
    expect(container.querySelector('[data-testid="tool-burst-header"]')).toBeNull();
    expect(screen.getByTestId("stub-plugin")).toBeTruthy();
  });
});

describe("CollapsedToolGroup — absorbed custom rows (F5/F6/F8)", () => {
  function group(): ToolCallGroup {
    const msgs = [tool(), tool(), tool()];
    const c = custom();
    return {
      type: "group",
      toolName: "edit",
      summary: "Edit",
      messages: msgs,
      rendered: [msgs[0], c, msgs[1], msgs[2]],
    };
  }

  it("F5: a claimed row absorbed into an EXPANDED ×N group renders via the plugin", () => {
    const { container } = wrap(<CollapsedToolGroup group={group()} toolContext={toolContext} />, prefsWith());
    fireEvent.click(container.querySelector('[data-testid="collapsed-group"]')!);
    expect(screen.getByTestId("stub-plugin")).toBeTruthy();
  });

  it("F6: the same absorbed row renders NOTHING when its group is hidden", () => {
    const { container } = wrap(
      <CollapsedToolGroup group={group()} toolContext={toolContext} />,
      prefsWith({ memory: false }),
    );
    fireEvent.click(container.querySelector('[data-testid="collapsed-group"]')!);
    expect(screen.queryByTestId("stub-plugin")).toBeNull();
  });

  it("F8: a custom row survives a ×N group whose tool members are all hidden", () => {
    const msgs = [tool("bash"), tool("bash"), tool("bash")];
    const c = custom();
    const g: ToolCallGroup = {
      type: "group",
      toolName: "bash",
      summary: "Bash",
      messages: msgs,
      rendered: [msgs[0], c, msgs[1], msgs[2]],
    };
    wrap(<CollapsedToolGroup group={g} toolContext={toolContext} />, prefsWith({ preset: DISPLAY_PRESETS.simple }));
    expect(screen.getByTestId("stub-plugin")).toBeTruthy();
  });
});
