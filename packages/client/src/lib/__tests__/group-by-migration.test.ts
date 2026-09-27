/**
 * Urgency-toggle retirement migration. See change: session-list-group-by (D8).
 */
import type { GroupByPrefs } from "@blackbelt-technology/pi-dashboard-shared/session-group-by.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideUrgencyMigration,
  LEGACY_FOLDER_URGENCY_SORT_KEY,
  runUrgencyMigration,
} from "../session/group-by-migration.js";

const prefs = (folderGroupBy: GroupByPrefs["folderGroupBy"] = {}): GroupByPrefs => ({
  defaultGroupBy: "none",
  folderGroupBy,
  collapsedLanes: [],
});

beforeEach(() => localStorage.removeItem(LEGACY_FOLDER_URGENCY_SORT_KEY));

describe("decideUrgencyMigration", () => {
  it("migrates folders without an explicit mode, keeps existing ones", () => {
    expect(decideUrgencyMigration(["/repo", "/other", "/repo"], prefs({ "/other/": "location" }))).toEqual(["/repo"]);
  });
});

describe("runUrgencyMigration", () => {
  it("sends status for legacy folders; clears the key only after the server echo confirms", () => {
    localStorage.setItem(LEGACY_FOLDER_URGENCY_SORT_KEY, JSON.stringify(["/repo"]));
    const send = vi.fn();
    const sent = new Set<string>();
    expect(runUrgencyMigration(prefs(), send, sent)).toEqual(["/repo"]);
    expect(send).toHaveBeenCalledWith("/repo", "status");
    // Not confirmed yet (e.g. socket dropped) → key kept for the next load.
    expect(localStorage.getItem(LEGACY_FOLDER_URGENCY_SORT_KEY)).not.toBeNull();
    // A re-render with the same unconfirmed snapshot does not re-send.
    expect(runUrgencyMigration(prefs(), send, sent)).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
    // Echo lands → cleared.
    runUrgencyMigration(prefs({ "/repo": "status" }), send, sent);
    expect(localStorage.getItem(LEGACY_FOLDER_URGENCY_SORT_KEY)).toBeNull();
  });

  it("never overwrites an explicit mode, still clears the key", () => {
    localStorage.setItem(LEGACY_FOLDER_URGENCY_SORT_KEY, JSON.stringify(["/repo"]));
    const send = vi.fn();
    runUrgencyMigration(prefs({ "/repo": "location" }), send);
    expect(send).not.toHaveBeenCalled();
    expect(localStorage.getItem(LEGACY_FOLDER_URGENCY_SORT_KEY)).toBeNull();
  });

  it("does nothing and keeps the key before the server snapshot", () => {
    localStorage.setItem(LEGACY_FOLDER_URGENCY_SORT_KEY, JSON.stringify(["/repo"]));
    const send = vi.fn();
    runUrgencyMigration(undefined, send);
    expect(send).not.toHaveBeenCalled();
    expect(localStorage.getItem(LEGACY_FOLDER_URGENCY_SORT_KEY)).not.toBeNull();
  });

  it("no legacy key ⇒ no-op", () => {
    const send = vi.fn();
    expect(runUrgencyMigration(prefs(), send)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});
