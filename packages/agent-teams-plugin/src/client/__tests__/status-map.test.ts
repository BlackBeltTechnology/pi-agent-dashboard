/**
 * `status-map.ts` — the single status table of design D12 (test-plan S12): every
 * member status, team status and task state maps to a shape glyph, an i18n text
 * key and a `ui:status-pill` state; glyphs are pairwise distinct inside a set;
 * an unknown (future) status falls back to "unknown" without throwing.
 * See change: add-agent-teams-ui.
 */
import { describe, expect, it } from "vitest";
import type { MemberStatus, TaskStatus, TeamStatus } from "../../shared/types.js";
import {
  MEMBER_STATUS,
  memberStatusEntry,
  PILL_STATES,
  TASK_BLOCKED,
  TASK_STATUS,
  TEAM_STATUS,
  taskStatusEntry,
  teamStatusEntry,
  UNKNOWN_STATUS,
  URGENT_MARKER,
} from "../status-map.js";

const MEMBERS: Array<[MemberStatus, string]> = [
  ["spawning", "info"],
  ["idle", "muted"],
  ["busy", "running"],
  ["shutdown_pending", "warn"],
  ["disconnected", "warn"],
  ["gone", "muted"],
  ["failed", "error"],
];
const TEAMS: Array<[TeamStatus, string]> = [
  ["starting", "info"],
  ["active", "success"],
  ["orphaned", "warn"],
  ["closing", "warn"],
  ["closed", "muted"],
];
const TASKS: Array<[TaskStatus, string]> = [
  ["pending", "muted"],
  ["in_progress", "info"],
  ["completed", "success"],
];

describe("status-map (S12)", () => {
  it.each(MEMBERS)("member %s maps to pill state %s with glyph and text key", (status, pill) => {
    const e = memberStatusEntry(status);
    expect(e).toBe(MEMBER_STATUS[status]);
    expect(e.pill).toBe(pill);
    expect(e.glyph.length).toBeGreaterThan(0);
    expect(e.textKey).toBe(`status.member.${status}`);
    expect(e.sentenceKey).toBe(`announce.member.${status}`);
  });

  it.each(TEAMS)("team %s maps to pill state %s", (status, pill) => {
    const e = teamStatusEntry(status);
    expect(e).toBe(TEAM_STATUS[status]);
    expect(e.pill).toBe(pill);
    expect(e.textKey).toBe(`status.team.${status}`);
    expect(e.glyph.length).toBeGreaterThan(0);
  });

  it.each(TASKS)("task %s maps to pill state %s", (status, pill) => {
    const e = taskStatusEntry(status);
    expect(e).toBe(TASK_STATUS[status]);
    expect(e.pill).toBe(pill);
    expect(e.textKey).toBe(`status.task.${status}`);
  });

  it("covers exactly the core status sets (no missing, no extra row)", () => {
    expect(Object.keys(MEMBER_STATUS).sort()).toEqual(MEMBERS.map(([s]) => s).sort());
    expect(Object.keys(TEAM_STATUS).sort()).toEqual(TEAMS.map(([s]) => s).sort());
    expect(Object.keys(TASK_STATUS).sort()).toEqual(TASKS.map(([s]) => s).sort());
  });

  it("uses only ui:status-pill states and non-empty strings everywhere", () => {
    const all = [
      ...Object.values(MEMBER_STATUS),
      ...Object.values(TEAM_STATUS),
      ...Object.values(TASK_STATUS),
      TASK_BLOCKED,
      URGENT_MARKER,
      UNKNOWN_STATUS,
    ];
    for (const e of all) {
      expect(PILL_STATES).toContain(e.pill);
      expect(e.glyph.trim()).not.toBe("");
      expect(e.textKey.trim()).not.toBe("");
    }
  });

  it("glyphs are pairwise distinct inside each set (status is never colour alone)", () => {
    for (const set of [MEMBER_STATUS, TEAM_STATUS, TASK_STATUS]) {
      const glyphs = Object.values(set).map((e) => e.glyph);
      expect(new Set(glyphs).size).toBe(glyphs.length);
    }
    expect(TASK_BLOCKED.glyph).not.toBe(URGENT_MARKER.glyph);
  });

  it("an unknown status falls back to the 'unknown' entry and never throws", () => {
    for (const bad of ["lock_wait", "", "constructor", "__proto__", "toString"]) {
      expect(memberStatusEntry(bad)).toBe(UNKNOWN_STATUS);
      expect(teamStatusEntry(bad)).toBe(UNKNOWN_STATUS);
      expect(taskStatusEntry(bad)).toBe(UNKNOWN_STATUS);
    }
    expect(memberStatusEntry(undefined)).toBe(UNKNOWN_STATUS);
    expect(memberStatusEntry(5 as unknown as string)).toBe(UNKNOWN_STATUS);
    expect(UNKNOWN_STATUS.textKey).toBe("status.unknown");
  });

  it("carries the blocked and urgent markers as shape + text key", () => {
    expect(TASK_BLOCKED).toMatchObject({ pill: "warn", textKey: "status.task.blocked" });
    expect(URGENT_MARKER).toMatchObject({ pill: "warn", textKey: "status.urgent" });
  });
});
