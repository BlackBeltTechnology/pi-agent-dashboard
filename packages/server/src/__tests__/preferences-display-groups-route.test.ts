/**
 * Tests for `PATCH /api/preferences/display` deep-merging `customEventGroups`
 * and broadcasting `display_prefs_updated` (task 5.4).
 *
 * See change: add-custom-event-group-filters.
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { DisplayPrefs } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { DISPLAY_PRESETS } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";

import { registerPreferencesDisplayRoutes } from "../routes/preferences-display-routes.js";

function buildApp(prefs: DisplayPrefs | undefined) {
  const app = Fastify();
  const current = prefs ? { ...prefs, toolCalls: { ...prefs.toolCalls }, customEventGroups: { ...prefs.customEventGroups } } : undefined;
  const broadcast = vi.fn();
  registerPreferencesDisplayRoutes(app, {
    preferencesStore: {
      getDisplayPrefs: () => current,
      setDisplayPrefs: (partial: any) => {
        // Mirror the store's field-by-field customEventGroups arm.
        const base = current ?? DISPLAY_PRESETS.standard;
        const merged = {
          ...base,
          ...partial,
          customEventGroups: { ...base.customEventGroups, ...(partial.customEventGroups ?? {}) },
        };
        Object.assign(current!, merged);
        return JSON.parse(JSON.stringify(merged));
      },
    } as any,
    networkGuard: async () => {},
    broadcast,
  });
  return { app, broadcast };
}

describe("PATCH /api/preferences/display — customEventGroups deep merge (task 5.4)", () => {
  it("a PATCH of one group id preserves every other key and broadcasts", async () => {
    const { app, broadcast } = buildApp({
      ...DISPLAY_PRESETS.standard,
      customEventGroups: { memory: false, search: true, subagents: true, other: true },
    });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/preferences/display",
      payload: { customEventGroups: { search: false } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { displayPrefs: DisplayPrefs };
    // merged, not replaced
    expect(body.displayPrefs.customEventGroups).toEqual({
      memory: false,
      search: false,
      subagents: true,
      other: true,
    });
    // broadcast fired with the new effective prefs
    expect(broadcast).toHaveBeenCalledTimes(1);
    const msg = broadcast.mock.calls[0][0] as { type: string; prefs: DisplayPrefs };
    expect(msg.type).toBe("display_prefs_updated");
    expect(msg.prefs.customEventGroups.search).toBe(false);
    // top-level fields absent from the PATCH body are preserved
    expect(body.displayPrefs.debugTools).toBe(DISPLAY_PRESETS.standard.debugTools);
  });
});
