import type { CardSectionPrefs } from "@blackbelt-technology/pi-dashboard-shared/card-sections.js";
import { renderHook } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  CardSectionsProvider,
  useFocusActions,
  useFocusState,
  usePluginSectionFilter,
} from "../CardSectionsContext.js";

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
