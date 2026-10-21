/**
 * chatMotion preference persistence — test-plan #E2 (legacy backfill),
 * #E3 (partial PATCH preserves), #E4 (runtime rollback). Uses the real store
 * behind the real PATCH route so both `setDisplayPrefs` literals are covered.
 * See change: add-fluid-chat-motion.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DISPLAY_PRESETS, type DisplayPrefs } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreferencesStore } from "../persistence/preferences-store.js";
import { registerPreferencesDisplayRoutes } from "../routes/preferences-display-routes.js";

const LEGACY_DISPLAY_PREFS = {
  tokenStatsBar: true,
  contextUsageBar: true,
  reasoning: false,
  toolResults: true,
  turnMetadata: true,
  debugTools: false,
  toolCalls: { read: true, bash: true, edit: true, agent: true, generic: true },
};

describe("chatMotion persistence", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pref-chat-motion-"));
    filePath = path.join(tmpDir, "preferences.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function buildApp(store: ReturnType<typeof createPreferencesStore>) {
    const app = Fastify();
    const broadcast = vi.fn();
    registerPreferencesDisplayRoutes(app, {
      preferencesStore: store,
      networkGuard: async () => {},
      broadcast,
    });
    return { app, broadcast };
  }

  it("E2: a legacy displayPrefs file loads with chatMotion true, never undefined", () => {
    fs.writeFileSync(filePath, JSON.stringify({ displayPrefs: LEGACY_DISPLAY_PREFS }));
    const store = createPreferencesStore(filePath);
    expect(store.getDisplayPrefs()?.chatMotion).toBe(true);
    store.dispose();
  });

  it("E2: seeding from nothing (base literal) also yields chatMotion true", () => {
    const store = createPreferencesStore(filePath);
    expect(store.setDisplayPrefs({ debugTools: true }).chatMotion).toBe(true);
    store.dispose();
  });

  it("E3: a partial PATCH preserves a stored chatMotion=false and broadcasts it", async () => {
    fs.writeFileSync(
      filePath,
      JSON.stringify({ displayPrefs: { ...DISPLAY_PRESETS.standard, chatMotion: false } }),
    );
    const store = createPreferencesStore(filePath);
    const { app, broadcast } = buildApp(store);

    const res = await app.inject({
      method: "PATCH",
      url: "/api/preferences/display",
      payload: { notifyMinLevel: "warning" },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { displayPrefs: DisplayPrefs }).displayPrefs.chatMotion).toBe(false);
    expect(store.getDisplayPrefs()?.chatMotion).toBe(false);
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "display_prefs_updated",
        prefs: expect.objectContaining({ chatMotion: false }),
      }),
    );
    store.dispose();
  });

  it("E4: PATCH {chatMotion:false} persists and broadcasts (runtime rollback)", async () => {
    fs.writeFileSync(
      filePath,
      JSON.stringify({ displayPrefs: { ...DISPLAY_PRESETS.standard, chatMotion: true } }),
    );
    const store = createPreferencesStore(filePath);
    const { app, broadcast } = buildApp(store);

    const res = await app.inject({
      method: "PATCH",
      url: "/api/preferences/display",
      payload: { chatMotion: false },
    });
    expect(res.statusCode).toBe(200);
    expect(store.getDisplayPrefs()?.chatMotion).toBe(false);
    store.flush();
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(data.displayPrefs.chatMotion).toBe(false);
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ prefs: expect.objectContaining({ chatMotion: false }) }),
    );
    store.dispose();
  });
});
