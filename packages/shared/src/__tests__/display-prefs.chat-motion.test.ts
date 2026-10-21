/**
 * chat-motion preference — test-plan #E1 (default) and #E5 (override wins).
 * See change: add-fluid-chat-motion.
 */
import { describe, expect, it } from "vitest";
import { DISPLAY_PRESETS, type DisplayPrefs, mergeDisplayPrefs } from "../display-prefs.js";

describe("chatMotion preference (E1)", () => {
  it("defaults to true in every preset and when merged with an empty override", () => {
    const names = ["simple", "standard", "everything"] as const;
    for (const name of names) expect(DISPLAY_PRESETS[name].chatMotion).toBe(true);
    // A persisted object that predates the field resolves through the merge.
    const legacy = { ...DISPLAY_PRESETS.standard } as Partial<DisplayPrefs> as DisplayPrefs;
    delete (legacy as Partial<DisplayPrefs>).chatMotion;
    expect(mergeDisplayPrefs(DISPLAY_PRESETS.standard, {}).chatMotion).toBe(true);
    expect(legacy.chatMotion).toBeUndefined();
  });
});

describe("chatMotion override (E5)", () => {
  it("a per-session override wins; a session without one inherits the global", () => {
    const global = DISPLAY_PRESETS.standard;
    expect(global.chatMotion).toBe(true);
    expect(mergeDisplayPrefs(global, { chatMotion: false }).chatMotion).toBe(false); // session A
    expect(mergeDisplayPrefs(global, undefined).chatMotion).toBe(true); // session B
    expect(mergeDisplayPrefs({ ...global, chatMotion: false }, { chatMotion: true }).chatMotion).toBe(true);
  });
});
