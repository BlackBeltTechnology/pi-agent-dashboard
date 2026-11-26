/**
 * UI wire contract (task 2.1): the strong ETag grammar, the closed error-code set
 * and the constants the server and client must share.
 * See change: add-agent-teams-ui.
 */
import { describe, expect, it } from "vitest";
import { AGENT_TEAMS_EVENT_CHANGED, AGENT_TEAMS_PLUGIN_ID } from "../plugin-id.js";
import { CHANGED_COALESCE_MS, LEAD_STAMP_KEY, SESSION_ID_MAX_LENGTH, snapshotEtag, UI_ERROR_CODES } from "../ui-protocol.js";

describe("ui-protocol", () => {
  it("snapshotEtag is a strong, quoted `<epoch>:<rev>`", () => {
    expect(snapshotEtag("abc", 41)).toBe('"abc:41"');
    expect(snapshotEtag("abc", 41)).not.toMatch(/^W\//);
    expect(snapshotEtag("abc", 41, true)).toBe('"abc:41"');
    expect(snapshotEtag("abc", 41, false)).toBe('"abc:41:ro"');
  });

  it("error codes are exactly the four this change adds", () => {
    expect([...UI_ERROR_CODES].sort()).toEqual(["bad_session_id", "not_busy", "not_connected", "team_closed"]);
  });

  it("the frame type is namespaced by the plugin id; the stamp key is distinct from core's `agent-teams` ref", () => {
    expect(AGENT_TEAMS_EVENT_CHANGED).toBe(`${AGENT_TEAMS_PLUGIN_ID}:changed`);
    expect(LEAD_STAMP_KEY).not.toBe(AGENT_TEAMS_PLUGIN_ID);
    expect(LEAD_STAMP_KEY.startsWith(AGENT_TEAMS_PLUGIN_ID)).toBe(true);
    expect(CHANGED_COALESCE_MS).toBe(1000);
    expect(SESSION_ID_MAX_LENGTH).toBe(128);
  });
});
