/**
 * SettingsPanel — the chat-display controls
 * (changes: render-inline-reasoning-and-custom-entries,
 * add-custom-event-group-filters).
 *
 * - `reasoningInlineFlow` joins the reasoning GatedGroup: same sub-section as
 *   the auto-collapse + keep-open controls, VISIBLE but DISABLED while the
 *   `reasoning` master toggle is off, enabled when on.
 * - One toggle per configured custom event group (labels from the groups
 *   definitions fetch) replaces the removed single "Custom entries in chat"
 *   switch; its behavior is reachable via the `other` toggle.
 *
 * Harness glue copied from settings-page-composition.test.tsx.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../SettingsPanel.js";

const { fetchAutoInitWorktreePref, setAutoInitWorktreePref } = vi.hoisted(() => ({
  fetchAutoInitWorktreePref: vi.fn(),
  setAutoInitWorktreePref: vi.fn(),
}));
vi.mock("../../../lib/git/git-api.js", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/git/git-api.js")>("../../../lib/git/git-api.js");
  return { ...actual, fetchAutoInitWorktreePref, setAutoInitWorktreePref };
});
vi.mock("../../../lib/api/model-proxy-api.js", () => ({
  listApiKeys: vi.fn().mockResolvedValue({ keys: [], revoked: [] }),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn().mockResolvedValue(undefined),
  deleteApiKey: vi.fn().mockResolvedValue(undefined),
  refreshRegistry: vi.fn().mockResolvedValue(undefined),
}));

const mockConfig = {
  port: 8000,
  piPort: 9999,
  autoStart: true,
  autoShutdown: true,
  shutdownIdleSeconds: 300,
  spawnStrategy: "headless",
  tunnel: { enabled: true, watchdog: { enabled: true, intervalMs: 30000, failureThreshold: 3, probeTimeoutMs: 5000 } },
  devBuildOnReload: false,
  dashboardName: "",
  memoryLimits: { maxEventsPerSession: 200, maxStringFieldSize: 4000, maxWsBufferBytes: 4194304 },
};

function mockFetchConfig() {
  return vi.fn().mockImplementation((url: string, options?: any) => {
    if (url === "/api/config" && !options?.method) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: mockConfig }) });
    }
    if (url === "/api/config" && options?.method === "PUT") {
      return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
    }
    if (url === "/api/custom-event-groups" && !options?.method) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            groups: [
              { id: "memory", label: "Memory telemetry", default: false },
              { id: "search", label: "Web search results", default: true },
              { id: "other", label: "Catch-all other", default: true },
            ],
          }),
      });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  });
}

const INLINE_FLOW_LABEL = "Inline reasoning flow";
const LEGACY_CUSTOM_LABEL = "Custom entries in chat";

function chatDisplayPage() {
  render(<SettingsPanel />);
  return waitFor(() => screen.getByText("Interface")).then(() => {
    const rail = screen.getByTestId("settings-nav-rail");
    fireEvent.click(within(rail).getByRole("button", { name: "General" }));
    return waitFor(() => screen.getByText(/Chat display/i));
  });
}

function switchByLabel(label: string): HTMLButtonElement {
  // FieldShell wires <label htmlFor> to the control id, so the switch's
  // accessible name is the label text.
  return screen.getByRole("switch", { name: label }) as HTMLButtonElement;
}

describe("settings chat-display — reasoningInlineFlow + custom event groups (E10, add-custom-event-group-filters)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchAutoInitWorktreePref.mockResolvedValue(false);
    setAutoInitWorktreePref.mockResolvedValue(true);
    window.history.replaceState({}, "", "/settings/general");
    global.fetch = mockFetchConfig();
  });

  afterEach(() => cleanup());

  it("renders the inline-flow control visible but DISABLED while reasoning is off", async () => {
    await chatDisplayPage();
    const toggle = switchByLabel(INLINE_FLOW_LABEL);
    expect(toggle).toBeTruthy();
    // Default preset has reasoning off → visible-but-disabled (never hidden).
    expect(toggle.disabled).toBe(true);
  });

  it("ENABLES the inline-flow control once reasoning is on", async () => {
    await chatDisplayPage();
    fireEvent.click(switchByLabel("Reasoning blocks"));
    await waitFor(() => expect(switchByLabel(INLINE_FLOW_LABEL).disabled).toBe(false));
  });

  it("places the inline-flow control INSIDE the reasoning group (after auto-collapse, before tool calls)", async () => {
    await chatDisplayPage();
    const inlineFlow = switchByLabel(INLINE_FLOW_LABEL);
    const autoCollapse = screen.getByText("Reasoning auto-collapse");
    const toolCallsHead = screen.getByText("Tool calls");
    // DOM order: reasoning subhead … auto-collapse … inline-flow … tool-calls head.
    expect(inlineFlow.compareDocumentPosition(autoCollapse) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(inlineFlow.compareDocumentPosition(toolCallsHead) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders one toggle per configured custom event group with no session selected (task 7.4)", async () => {
    await chatDisplayPage();
    // Group labels come from the definitions fetch, in configured order.
    const memory = switchByLabel("Memory telemetry");
    expect(memory).toBeTruthy();
    expect(switchByLabel("Web search results")).toBeTruthy();
    expect(switchByLabel("Catch-all other")).toBeTruthy();
    const header = screen.getByText("Custom event groups");
    const search = switchByLabel("Web search results");
    // configured order: memory (default-hidden group) before search
    expect(header.compareDocumentPosition(memory) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(memory.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // absent-from-prefs group id resolves to its configured default:
    // memory default-hidden → off; search default-visible → on.
    expect(memory.getAttribute("aria-checked")).toBe("false");
    expect(search.getAttribute("aria-checked")).toBe("true");
  });

  it("the legacy single custom-entry toggle is gone (task 7.6)", async () => {
    await chatDisplayPage();
    expect(switchByLabel("Memory telemetry")).toBeTruthy(); // group rows present…
    expect(screen.queryByRole("switch", { name: LEGACY_CUSTOM_LABEL })).toBeNull(); // …legacy row absent
  });
});
