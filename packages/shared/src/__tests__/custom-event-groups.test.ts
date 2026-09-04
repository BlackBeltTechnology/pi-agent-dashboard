/**
 * Tests for the custom event groups config store
 * (`~/.pi/dashboard/custom-event-groups.json`).
 *
 * See change: add-custom-event-group-filters (tasks 1.1–1.5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  RESERVED_OTHER_GROUP_ID,
  SHIPPED_CUSTOM_EVENT_GROUPS,
  defaultCustomEventGroupPrefs,
} from "../custom-event-groups.js";
import { CustomEventGroupsStore } from "../custom-event-groups-store.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ceg-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function storePath(name = "custom-event-groups.json"): string {
  return path.join(tmpDir, name);
}

function readStoreFile(p: string): any {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

describe("shipped defaults (task 1.1)", () => {
  it("cover the emitters listed in proposal.md", () => {
    const byId = new Map(SHIPPED_CUSTOM_EVENT_GROUPS.map((g) => [g.id, g]));
    // memory telemetry — default HIDDEN
    expect(byId.get("memory")).toMatchObject({ pattern: "^om\\.", default: false });
    // web search results — actual content, visible
    expect(byId.get("search")).toMatchObject({ pattern: "^web-search-results$", default: true });
    // subagent bookkeeping + notices, visible
    expect(byId.get("subagents")).toMatchObject({ default: true });
    // flows help card, visible
    expect(byId.get("flows")).toMatchObject({ default: true });
    // goal plugin entries, visible
    expect(byId.get("goals")).toMatchObject({ default: true });
  });

  it("default prefs seed every shipped group plus the reserved other", () => {
    const prefs = defaultCustomEventGroupPrefs();
    for (const g of SHIPPED_CUSTOM_EVENT_GROUPS) {
      expect(prefs[g.id]).toBe(g.default);
    }
    expect(prefs[RESERVED_OTHER_GROUP_ID]).toBe(true);
  });
});

describe("store: missing file (task 1.2)", () => {
  it("creates the file with shipped defaults and records every shipped id", () => {
    const p = storePath();
    const store = new CustomEventGroupsStore({ filePath: p });
    const groups = store.list();
    // other synthesized last
    expect(groups[groups.length - 1]?.id).toBe(RESERVED_OTHER_GROUP_ID);
    expect(groups.some((g) => g.id === "memory" && g.default === false)).toBe(true);

    const file = readStoreFile(p);
    expect(file.version).toBe(1);
    const fileIds = file.groups.map((g: any) => g.id);
    for (const g of SHIPPED_CUSTOM_EVENT_GROUPS) expect(fileIds).toContain(g.id);
    expect(fileIds).toContain(RESERVED_OTHER_GROUP_ID);
    for (const g of SHIPPED_CUSTOM_EVENT_GROUPS) {
      expect(file.seenShippedIds).toContain(g.id);
    }
  });
});

describe("store: malformed configuration fails open (task 1.3)", () => {
  it("unparseable JSON falls back to shipped defaults, warns, leaves the file untouched", () => {
    const p = storePath();
    fs.writeFileSync(p, "{ not json !!!");
    const warns: string[] = [];
    const store = new CustomEventGroupsStore({ filePath: p, warn: (m) => warns.push(m) });
    expect(store.list().some((g) => g.id === "memory")).toBe(true);
    expect(warns.length).toBeGreaterThan(0);
    // file NOT rewritten
    expect(fs.readFileSync(p, "utf-8")).toBe("{ not json !!!");
  });

  it("non-array groups falls back to shipped defaults", () => {
    const p = storePath();
    fs.writeFileSync(p, JSON.stringify({ version: 1, groups: "nope", seenShippedIds: [] }));
    const store = new CustomEventGroupsStore({ filePath: p });
    expect(store.list().some((g) => g.id === "memory")).toBe(true);
  });

  it("entry missing id is skipped, valid entries retained", () => {
    const p = storePath();
    fs.writeFileSync(
      p,
      JSON.stringify({
        version: 1,
        groups: [{ label: "no id", pattern: "^x$", default: true }, { id: "mine", label: "Mine", pattern: "^mine\\.", default: false }],
        seenShippedIds: [],
      }),
    );
    const store = new CustomEventGroupsStore({ filePath: p });
    const ids = store.list().map((g) => g.id);
    expect(ids).not.toContain(undefined);
    expect(ids).toContain("mine");
    expect(ids).toContain("memory"); // shipped merge still ran
  });

  it("duplicate id keeps the first entry and skips the later one", () => {
    const p = storePath();
    fs.writeFileSync(
      p,
      JSON.stringify({
        version: 1,
        groups: [
          { id: "dup", label: "First", pattern: "^first\\.", default: true },
          { id: "dup", label: "Second", pattern: "^second\\.", default: false },
        ],
        seenShippedIds: [],
      }),
    );
    const store = new CustomEventGroupsStore({ filePath: p });
    const dup = store.list().find((g) => g.id === "dup");
    expect(dup?.label).toBe("First");
    expect(store.list().filter((g) => g.id === "dup")).toHaveLength(1);
  });

  it("missing or uncompilable pattern skips only its own group", () => {
    const p = storePath();
    fs.writeFileSync(
      p,
      JSON.stringify({
        version: 1,
        groups: [
          { id: "bad1", label: "No pattern", default: true },
          { id: "bad2", label: "Bad regex", pattern: "([unclosed", default: true },
          { id: "good", label: "Good", pattern: "^good\\.", default: true },
        ],
        seenShippedIds: [],
      }),
    );
    const store = new CustomEventGroupsStore({ filePath: p });
    const ids = store.list().map((g) => g.id);
    expect(ids).not.toContain("bad1");
    expect(ids).not.toContain("bad2");
    expect(ids).toContain("good");
  });
});

describe("store: reserved other (task 1.4)", () => {
  it("synthesizes other when the file omits it", () => {
    const p = storePath();
    fs.writeFileSync(
      p,
      JSON.stringify({
        version: 1,
        groups: [{ id: "mine", label: "Mine", pattern: "^mine\\.", default: false }],
        seenShippedIds: [],
      }),
    );
    const store = new CustomEventGroupsStore({ filePath: p });
    const groups = store.list();
    expect(groups.some((g) => g.id === RESERVED_OTHER_GROUP_ID)).toBe(true);
    // last position — resolution fallback
    expect(groups[groups.length - 1]?.id).toBe(RESERVED_OTHER_GROUP_ID);
  });
});

describe("store: reserved other is always the last resort", () => {
  it("relocates a user-authored other that sits mid-file to the tail", () => {
    const p = storePath();
    fs.writeFileSync(
      p,
      JSON.stringify({
        version: 1,
        groups: [
          { id: "other", label: "User Other", pattern: "^x$", default: false },
          { id: "mine", label: "Mine", pattern: "^mine\\.", default: true },
        ],
        seenShippedIds: [],
      }),
    );
    const store = new CustomEventGroupsStore({ filePath: p });
    const groups = store.list();
    expect(groups[groups.length - 1]?.id).toBe(RESERVED_OTHER_GROUP_ID);
    // identity preserved — only the position moved
    const other = groups[groups.length - 1];
    expect(other.label).toBe("User Other");
    expect(other.default).toBe(false);
    expect(groups.some((g) => g.id === "mine")).toBe(true);
  });
});

describe("store: seenShippedIds upgrade-merge (task 1.5)", () => {
  function writeUserFile(p: string, groups: any[], seenShippedIds: string[]): void {
    fs.writeFileSync(p, JSON.stringify({ version: 1, groups, seenShippedIds }));
  }

  it("genuinely new shipped group is appended after user entries and recorded", () => {
    const p = storePath();
    // Simulate a file from before the `goals` group shipped.
    const shippedWithoutGoals = SHIPPED_CUSTOM_EVENT_GROUPS.filter((g) => g.id !== "goals");
    writeUserFile(
      p,
      [{ id: "userrule", label: "User", pattern: "^om\\.observations\\.", default: true }, ...shippedWithoutGoals],
      shippedWithoutGoals.map((g) => g.id),
    );
    const store = new CustomEventGroupsStore({ filePath: p });
    const ids = store.list().map((g) => g.id);
    // appended AFTER user-authored entries
    expect(ids.indexOf("goals")).toBeGreaterThan(ids.indexOf("userrule"));
    const file = readStoreFile(p);
    expect(file.seenShippedIds).toContain("goals");
  });

  it("deleted shipped group stays deleted across loads", () => {
    const p = storePath();
    const shippedWithoutMemory = SHIPPED_CUSTOM_EVENT_GROUPS.filter((g) => g.id !== "memory");
    // User deleted `memory`; seenShippedIds still lists it.
    writeUserFile(
      p,
      [...shippedWithoutMemory],
      SHIPPED_CUSTOM_EVENT_GROUPS.map((g) => g.id),
    );
    const store = new CustomEventGroupsStore({ filePath: p });
    expect(store.list().some((g) => g.id === "memory")).toBe(false);
    // second load — still not resurrected
    const store2 = new CustomEventGroupsStore({ filePath: p });
    expect(store2.list().some((g) => g.id === "memory")).toBe(false);
  });

  it("merged group is appended after a broader user rule (ordering preserved)", () => {
    const p = storePath();
    const shippedWithoutSearch = SHIPPED_CUSTOM_EVENT_GROUPS.filter((g) => g.id !== "search");
    writeUserFile(
      p,
      [{ id: "broad", label: "Broad", pattern: "web|search", default: false }, ...shippedWithoutSearch],
      shippedWithoutSearch.map((g) => g.id),
    );
    const store = new CustomEventGroupsStore({ filePath: p });
    const ids = store.list().map((g) => g.id);
    expect(ids.indexOf("search")).toBeGreaterThan(ids.indexOf("broad"));
  });

  it("never records a non-shipped (user) group in seenShippedIds", () => {
    const p = storePath();
    writeUserFile(p, [{ id: "userrule", label: "User", pattern: "^u\\.", default: true }], []);
    new CustomEventGroupsStore({ filePath: p });
    const file = readStoreFile(p);
    expect(file.seenShippedIds).not.toContain("userrule");
    expect(file.seenShippedIds).not.toContain(RESERVED_OTHER_GROUP_ID);
  });
});

describe("definitions (task 4.4)", () => {
  it("expose id, label, default in resolution order — never the pattern", () => {
    const p = storePath();
    const store = new CustomEventGroupsStore({ filePath: p });
    const defs = store.definitions();
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) {
      expect(Object.keys(d).sort()).toEqual(["default", "id", "label"]);
    }
    expect(defs[defs.length - 1]?.id).toBe(RESERVED_OTHER_GROUP_ID);
  });
});
