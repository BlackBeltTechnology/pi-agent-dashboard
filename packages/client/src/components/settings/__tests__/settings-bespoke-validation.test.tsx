import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../SettingsPanel.js";
import { ToggleField } from "../SettingsPanel.js";

// spawnRegisterTimeoutMs stays a bespoke <input> precisely because its bounds
// check BLOCKS the write and DISABLES Save. Converting it to the shared
// NumberField (parseInt(...) || 0, no bounds) would turn an enforced
// constraint into advisory hint text — a behaviour change hiding inside a
// copy refactor (design D3). These tests pin the constraint so a later
// "tidy-up" cannot quietly delete it.
// See change: reorganize-settings-pages-and-descriptions. test-plan #E8-#E13.

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
  spawnRegisterTimeoutMs: 30000,
  tunnel: { enabled: true },
  devBuildOnReload: false,
  memoryLimits: { maxEventsPerSession: 200, maxStringFieldSize: 4000, maxWsBufferBytes: 4194304 },
};

let putBodies: any[] = [];

function mockFetchConfig() {
  return vi.fn().mockImplementation((url: string, options?: any) => {
    if (url === "/api/config" && !options?.method) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: mockConfig }) });
    }
    if (url === "/api/config" && options?.method === "PUT") {
      putBodies.push(JSON.parse(options.body));
      return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  });
}

function gotoPage(name: string) {
  fireEvent.click(within(screen.getByTestId("settings-nav-rail")).getByRole("button", { name }));
}

/** Render the panel, land on Sessions, and hand back the bespoke input. */
async function renderSessions(): Promise<HTMLInputElement> {
  render(<SettingsPanel />);
  await waitFor(() => screen.getByText("Interface"));
  gotoPage("Sessions");
  await waitFor(() => screen.getByText(/Session Strategy/i));
  const label = screen.getByText(/Session register timeout/i);
  return label.closest("div")!.querySelector("input[type=number]") as HTMLInputElement;
}

const ERROR_TEXT = /Must be an integer between 5000 and 120000/;
const saveBtn = () => screen.queryByTestId("save-btn") as HTMLButtonElement | null;

describe("bespoke spawnRegisterTimeoutMs keeps its bounds check", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    putBodies = [];
    fetchAutoInitWorktreePref.mockResolvedValue(false);
    setAutoInitWorktreePref.mockResolvedValue(true);
    window.history.replaceState({}, "", "/settings/general");
    global.fetch = mockFetchConfig();
  });
  afterEach(() => cleanup());

  // test-plan #E8 / #E11 / #E12 — invalid partitions
  for (const [name, value] of [["below minimum", "4999"], ["above maximum", "120001"], ["non-numeric", "abc"]] as const) {
    it(`rejects ${name}: no write, inline error, Save disabled`, async () => {
      const input = await renderSessions();
      fireEvent.change(input, { target: { value } });

      expect(screen.getByText(ERROR_TEXT)).toBeTruthy();
      // Save is either absent (nothing dirty) or present-but-disabled; it must
      // never be an enabled path to persisting the rejected value.
      expect(saveBtn()?.disabled ?? true).toBe(true);
      expect(putBodies).toHaveLength(0);
    });
  }

  // test-plan #E9 / #E10 — valid boundaries
  for (const [name, value] of [["minimum", "5000"], ["maximum", "120000"]] as const) {
    it(`accepts the ${name} boundary: no error, Save enabled`, async () => {
      const input = await renderSessions();
      fireEvent.change(input, { target: { value } });

      expect(screen.queryByText(ERROR_TEXT)).toBeNull();
      const btn = await waitFor(() => screen.getByTestId("save-btn"));
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    });
  }

  // test-plan #E13 — the invalid state must not be sticky
  it("re-enables Save once an out-of-range value is corrected", async () => {
    const input = await renderSessions();

    fireEvent.change(input, { target: { value: "4999" } });
    expect(screen.getByText(ERROR_TEXT)).toBeTruthy();

    // Must differ from the displayed value: the rejected write never landed,
    // so the controlled input still shows 30000 and re-entering it would not
    // fire a change event at all.
    fireEvent.change(input, { target: { value: "60000" } });
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
  });
});

describe("wrapper toggles forward their hint (D6)", () => {
  afterEach(() => cleanup());

  // test-plan #F20 — the description must live INSIDE the wrapper, wired to
  // the control, not orphaned as a sibling at the outer call site.
  it("wires a forwarded hint to the inner control via aria-describedby", () => {
    render(<ToggleField label="Wrapped" value={false} onChange={() => {}} hint="Forwarded description" />);

    const control = screen.getByRole("switch", { name: "Wrapped" });
    const describedBy = control.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe("Forwarded description");
  });
});
