/**
 * SettingsPanel — the two new chat-display controls
 * (change: render-inline-reasoning-and-custom-entries, test-plan E10).
 *
 * - `reasoningInlineFlow` joins the reasoning GatedGroup: same sub-section as
 *   the auto-collapse + keep-open controls, VISIBLE but DISABLED while the
 *   `reasoning` master toggle is off, enabled when on.
 * - `customEntryFallback` sits adjacent to (immediately after, DOM order) the
 *   "Extension notifications" select — both are extension-row visibility
 *   controls.
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
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  });
}

const INLINE_FLOW_LABEL = "Inline reasoning flow";
const CUSTOM_FALLBACK_LABEL = "Custom entries in chat";

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

describe("settings chat-display — reasoningInlineFlow + customEntryFallback (E10)", () => {
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

  it("places the custom-entry control ADJACENT to (right after) Extension notifications", async () => {
    await chatDisplayPage();
    const customToggle = switchByLabel(CUSTOM_FALLBACK_LABEL);
    const notifyLabel = screen.getByText("Extension notifications");
    // Adjacent in DOM order: notifications first, custom entries immediately
    // after — no unrelated control between them (FieldShell outer divs are
    // siblings; each contains its flex row + hint paragraph).
    const notifyField = notifyLabel.closest("div.flex")!.parentElement!;
    const customField = customToggle.closest("div.flex")!.parentElement!;
    expect(notifyField.nextElementSibling).toBe(customField);
  });

  it("renders the custom-entry toggle enabled by default (fallback defaults ON)", async () => {
    await chatDisplayPage();
    const toggle = switchByLabel(CUSTOM_FALLBACK_LABEL);
    expect(toggle).toBeTruthy();
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });
});
