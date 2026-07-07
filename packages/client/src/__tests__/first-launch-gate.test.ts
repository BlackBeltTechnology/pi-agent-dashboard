/**
 * Tests for the first-launch modal render gate (RC3) and its close paths.
 *
 * The gate logic lives inline in App.tsx's mount effect + render. To keep
 * this a focused unit test, the mount-fetch seedless detection and the gate
 * predicate are mirrored here exactly. Any future change MUST keep the two
 * implementations in sync (same pattern as display-prefs-migration.test.ts).
 *
 * See change: fix-first-launch-display-modal-stuck-on-mobile.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { DISPLAY_PRESETS, type DisplayPrefs } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";

interface MountState {
  displayPrefs: DisplayPrefs | undefined;
  displayPrefsLoaded: boolean;
  displayPrefsSeedless: boolean;
}

// Mirrors App.tsx mount fetch: `if (!r.ok) return;` sets seedless ONLY on a
// successful GET with undefined prefs; `loaded` flips in `finally` regardless.
async function runMount(apiBase = ""): Promise<MountState> {
  const state: MountState = { displayPrefs: undefined, displayPrefsLoaded: false, displayPrefsSeedless: false };
  try {
    const r = await fetch(`${apiBase}/api/preferences/display`, { credentials: "include" });
    if (!r.ok) return state;
    const body = (await r.json()) as { displayPrefs?: DisplayPrefs };
    state.displayPrefs = body.displayPrefs;
    if (body.displayPrefs === undefined) state.displayPrefsSeedless = true;
  } catch { /* ignore */ }
  finally {
    state.displayPrefsLoaded = true;
  }
  return state;
}

// Mirrors the App.tsx render gate.
const gateOpen = (s: MountState) => s.displayPrefsSeedless && s.displayPrefs === undefined;

describe("first-launch modal render gate", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    (globalThis as any).fetch = fetchMock;
  });

  it("(a) a failed/denied GET leaves the modal closed (seedless stays false)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    const s = await runMount();
    expect(s.displayPrefsLoaded).toBe(true); // rest of app proceeds
    expect(s.displayPrefsSeedless).toBe(false);
    expect(gateOpen(s)).toBe(false);
  });

  it("(a') a thrown GET leaves the modal closed", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const s = await runMount();
    expect(gateOpen(s)).toBe(false);
  });

  it("(b) a 200 with undefined prefs opens the modal", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const s = await runMount();
    expect(s.displayPrefsSeedless).toBe(true);
    expect(gateOpen(s)).toBe(true);
  });

  it("(c) onClose(prefs) closes the modal by defining displayPrefs", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const s = await runMount();
    expect(gateOpen(s)).toBe(true);
    // onClose → setDisplayPrefs(prefs)
    s.displayPrefs = DISPLAY_PRESETS.standard;
    expect(gateOpen(s)).toBe(false);
  });

  it("(d) a display_prefs_updated broadcast closes the modal by defining displayPrefs", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const s = await runMount();
    expect(gateOpen(s)).toBe(true);
    // useMessageHandler: setDisplayPrefs(msg.prefs)
    s.displayPrefs = DISPLAY_PRESETS.everything;
    expect(gateOpen(s)).toBe(false);
  });

  it("a 200 with defined prefs never opens the modal", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ displayPrefs: DISPLAY_PRESETS.simple }) });
    const s = await runMount();
    expect(s.displayPrefsSeedless).toBe(false);
    expect(gateOpen(s)).toBe(false);
  });
});
