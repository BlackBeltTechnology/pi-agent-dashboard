import type { CardSectionPrefs } from "@blackbelt-technology/pi-dashboard-shared/card-sections.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SessionList } from "../../../components/session/SessionList.js";
import { ThemeProvider } from "../../../components/settings/ThemeProvider.js";
import {
  CardSectionsProvider,
  useFocusActions,
  useFocusState,
  usePluginSectionFilter,
} from "../CardSectionsContext.js";

// The init-status probe puts a folder into a banner rung; drive it per test.
const probe = vi.hoisted(() => ({ status: { hasHook: true, trusted: false } as { hasHook: boolean; trusted?: boolean } }));
vi.mock("../../git/git-api.js", async (orig) => ({
  ...(await orig<typeof import("../../git/git-api.js")>()),
  fetchWorktreeInitStatus: vi.fn(async () => probe.status),
}));

const IDS = ["git", "flows", "openspec", "openspec-badge", "badge-goal", "process", "fx-selected-glow"];

function wrap(prefs: CardSectionPrefs, extra: Record<string, unknown> = {}) {
  const send = vi.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <CardSectionsProvider value={{ prefs, send, connected: true, ...extra }}>{children}</CardSectionsProvider>
  );
  return { send, wrapper };
}

describe("focus actions", () => {
  it("saveCurrent snapshots the Focus-off global resolution (explicit, incl. parent-derived)", () => {
    const { send, wrapper } = wrap(
      { global: { git: false, flows: true, openspec: false }, focus: { enabled: true } },
      { folderListMode: "classic" },
    );
    const { result } = renderHook(() => useFocusActions(), { wrapper });
    result.current.saveCurrent(IDS);
    const profile = send.mock.calls[0][0].profile;
    expect(send.mock.calls[0][0].type).toBe("set_focus_profile");
    expect(profile.sections).toMatchObject({ git: false, flows: true, "openspec-badge": false, process: true });
    expect(profile.folderListMode).toBe("classic");
  });

  it("setRow edits only one key of a stored profile", () => {
    const { send, wrapper } = wrap({ focus: { profile: { sections: { git: false, flows: false }, folderListMode: "accordion" } } });
    const { result } = renderHook(() => useFocusActions(), { wrapper });
    result.current.setRow("badge-automation", true, IDS);
    expect(send.mock.calls[0][0].profile).toEqual({
      sections: { git: false, flows: false, "badge-automation": true },
      folderListMode: "accordion",
    });
    result.current.setRow("git", null, IDS);
    expect(send.mock.calls[1][0].profile.sections).toEqual({ flows: false });
  });

  it("first edit copies the built-in profile", () => {
    const { send, wrapper } = wrap({ focus: { enabled: true } });
    const { result } = renderHook(() => ({ a: useFocusActions(), s: useFocusState() }), { wrapper });
    expect(result.current.s).toMatchObject({ enabled: true, custom: false });
    result.current.a.setRow("badge-goal", true, IDS);
    const profile = send.mock.calls[0][0].profile;
    expect(profile.sections).toMatchObject({ git: false, "openspec-badge": false, "fx-selected-glow": false, "badge-goal": true });
    expect(profile.sections).not.toHaveProperty("process");
    expect(profile.folderListMode).toBe("accordion");
  });

  it("setEnabled / reset send the right messages; canWrite follows connected", () => {
    const { send, wrapper } = wrap({});
    const { result } = renderHook(() => useFocusActions(), { wrapper });
    result.current.setEnabled(true);
    result.current.reset();
    expect(send.mock.calls).toEqual([[{ type: "set_focus_mode", enabled: true }], [{ type: "set_focus_profile", profile: null }]]);
    const off = renderHook(() => useFocusActions(), {
      wrapper: ({ children }) => (
        <CardSectionsProvider value={{ prefs: {}, send: vi.fn(), connected: false }}>{children}</CardSectionsProvider>
      ),
    });
    expect(off.result.current.canWrite).toBe(false);
  });
});

describe("usePluginSectionFilter", () => {
  it("hides a plugin whose per-plugin id resolves hidden; invalid ids stay visible", () => {
    const { wrapper } = wrap({ global: { "badge-automation": false } });
    const { result } = renderHook(() => usePluginSectionFilter("badge", "/a"), { wrapper });
    expect(result.current("automation")).toBe(false);
    expect(result.current("goal")).toBe(true);
    expect(result.current("Bad_Id")).toBe(true);
  });
  it("legacy status parent hides badges", () => {
    const { wrapper } = wrap({ global: { status: false } });
    const { result } = renderHook(() => usePluginSectionFilter("badge", "/a"), { wrapper });
    expect(result.current("goal")).toBe(false);
  });
});

// Focus mode × folder compact chip, live toggling and a missing provider (#1134).
// See change: sidebar-folder-ux (test-plan #F7, #X8).
describe("focus × folder chip (SessionList integration)", () => {
  const CWD = "/home/user/project";
  const session: DashboardSession = {
    id: "s1", cwd: CWD, source: "tui", status: "active", startedAt: Date.now() - 60_000,
    tokensIn: 0, tokensOut: 0, cost: 0,
  };
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      })),
    });
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { for (const k in store) delete store[k]; },
      get length() { return Object.keys(store).length; },
      key: (i: number) => Object.keys(store)[i] ?? null,
    });
  });
  afterEach(cleanup);

  function tree(prefs: CardSectionPrefs | null) {
    const { hook } = memoryLocation({ path: "/", static: true });
    const list = <SessionList sessions={[session]} selectedId="s1" onSelect={() => {}} onSpawnSession={() => {}} />;
    return (
      <Router hook={hook}>
        <ThemeProvider>{prefs ? <CardSectionsProvider value={{ prefs }}>{list}</CardSectionsProvider> : list}</ThemeProvider>
      </Router>
    );
  }
  const chip = () => screen.queryByTestId(`folder-banner-chip-${CWD}`);
  const banner = () => screen.queryByTestId(`folder-banner-retrust-${CWD}`);
  // Banner hidden OUTSIDE Focus too, so the chip is what shows when Focus is off.
  const OFF: CardSectionPrefs = { global: { "folder-banner": false }, focus: { enabled: false } };
  const ON: CardSectionPrefs = { global: { "folder-banner": false }, focus: { enabled: true } };

  it("F7: Focus on/off converges — no chip or revealed banner leaks in Focus; chip (not banner) returns after", async () => {
    const r = render(tree(OFF));
    await waitFor(() => expect(chip()).not.toBeNull());
    fireEvent.click(chip()!); // reveal the full banner
    expect(banner()).not.toBeNull();

    r.rerender(tree(ON));
    await waitFor(() => expect(chip()).toBeNull());
    expect(banner()).toBeNull();

    r.rerender(tree(OFF));
    await waitFor(() => expect(chip()).not.toBeNull());
    expect(banner()).toBeNull();
  });

  it("X8: without a CardSectionsContext provider Focus defaults off and the chip behaviour is unchanged", async () => {
    const { result } = renderHook(() => useFocusState());
    expect(result.current.enabled).toBe(false);
    render(tree(null));
    // No prefs → folder-banner visible → full banner, rendered without throwing.
    await waitFor(() => expect(banner()).not.toBeNull());
    expect(chip()).toBeNull();
  });
});
