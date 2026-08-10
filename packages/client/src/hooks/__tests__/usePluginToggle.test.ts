/**
 * `PluginStatus.enabled` from `GET /api/plugins` is the RUNTIME load state the
 * server captured at boot: `POST /api/plugins/:id/toggle` writes
 * `config.plugins.<id>.enabled` and returns `restartRequired: true`, so neither
 * `/api/plugins` nor `/api/health` reflects the flip until a restart. Verified
 * against the docker harness — disabling `subagents` left both endpoints
 * reporting `enabled: true`.
 *
 * The toggle checkbox, the nav-rail membership, and the page's disabled notice
 * must all track the DESIRED state instead, or design D6's live collapse and
 * the "toggling a plugin updates the rail" scenario are unreachable.
 *
 * See change: plugin-settings-pages.
 */
import { describe, expect, it } from "vitest";
import type { PluginRow } from "../../lib/package/plugins-api.js";
import { applyDesiredEnabled } from "../usePluginToggle.js";

function row(id: string, enabled: boolean, loaded = true): PluginRow {
  return {
    id,
    displayName: id,
    priority: 100,
    hasServer: false,
    hasBridge: false,
    hasClient: true,
    claims: [],
    requires: null,
    status: { id, displayName: id, enabled, loaded, claims: 0, missingRequirements: [] },
  } as unknown as PluginRow;
}

describe("applyDesiredEnabled", () => {
  it("returns the same array when nothing is overridden", () => {
    const rows = [row("a", true)];
    expect(applyDesiredEnabled(rows, {})).toBe(rows);
  });

  it("overrides a stale enabled flag with the desired state", () => {
    const out = applyDesiredEnabled([row("subagents", true)], { subagents: false });
    expect(out[0].status?.enabled).toBe(false);
  });

  it("leaves `loaded` alone — it stays the runtime truth", () => {
    const out = applyDesiredEnabled([row("flows", true, true)], { flows: false });
    expect(out[0].status?.loaded).toBe(true);
  });

  it("ignores ids it has no desired state for", () => {
    const out = applyDesiredEnabled([row("a", true), row("b", true)], { b: false });
    expect(out[0].status?.enabled).toBe(true);
    expect(out[1].status?.enabled).toBe(false);
  });

  it("preserves row identity when the desired state already matches", () => {
    const rows = [row("a", true)];
    const out = applyDesiredEnabled(rows, { a: true });
    expect(out[0]).toBe(rows[0]);
  });
});
