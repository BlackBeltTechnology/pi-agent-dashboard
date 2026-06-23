import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteFtsStore } from "@blackbelt-technology/pi-dashboard-kb";
import { indexSource } from "@blackbelt-technology/pi-dashboard-kb";
import {
  createReindexState, reindexNow, decideNudge, nudgeText, acknowledgeRows, getKb, closeKb,
} from "../reindex.js";

// Build a temp project with a KB config so reindex logic can open a real store.
function setupProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "kb-ext-"));
  mkdirSync(join(dir, ".pi", "dashboard", "kb"), { recursive: true });
  writeFileSync(join(dir, ".pi", "dashboard", "knowledge_base.json"), JSON.stringify({
    sources: [{ kind: "filesystem", ref: "docs", priority: 5 }],
    dbPath: ".pi/dashboard/kb/index.db",
  }));
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "guide.md"), "# Guide\ninitial content padded to survive the merge threshold cleanly here.\n");
  return dir;
}

describe("reindex Job 1: edit .md → index reflects change", () => {
  let dir: string;
  beforeAll(() => (dir = setupProject()));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reindexNow picks up an edited file without manual kb index", () => {
    const state = createReindexState();
    reindexNow(state, dir); // cold index
    const { store } = getKb(state, dir);
    expect(store.search("initial content padded", { limit: 3 }).length).toBeGreaterThan(0);

    // edit the file
    writeFileSync(join(dir, "docs", "guide.md"), "# Guide\nrewritten totally different zebras are exotic animals here.\n");
    reindexNow(state, dir); // incremental
    const hits = store.search("rewritten totally different zebras", { limit: 3 });
    expect(hits[0]?.path).toMatch(/guide\.md$/);
    // old content gone
    expect(store.search("initial content padded", { limit: 3 }).length).toBe(0);
    closeKb(state);
  });
});

describe("DOX nudge Job 2: decideNudge + acknowledgeRows", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "kb-doxext-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "AGENTS.md"), "# DOX\n\n| `src/a.ts` |  |\n");
    writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(join(dir, "src", "b.ts"), "export const b = 2;\n");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("missing row → missing decision", () => {
    const d = decideNudge(dir, join(dir, "src", "b.ts"));
    expect(d?.kind).toBe("missing");
    expect(nudgeText(d, "src/b.ts")).toContain("src/b.ts");
  });

  it("clean (row exists, not stale) → null", () => {
    // a.ts has a row and no staleness sidecar → not stale
    const d = decideNudge(dir, join(dir, "src", "a.ts"));
    expect(d).toBeNull();
  });

  it("treeless path → treeless decision", () => {
    const bare = mkdtempSync(join(tmpdir(), "kb-treeless-"));
    try {
      writeFileSync(join(bare, "x.ts"), "x;\n");
      const d = decideNudge(bare, join(bare, "x.ts"));
      expect(d?.kind).toBe("treeless");
      expect(nudgeText(d, "x.ts")).toContain("kb dox init");
    } finally { rmSync(bare, { recursive: true, force: true }); }
  });

  it("acknowledgeRows clears stale flags after AGENTS.md edit", () => {
    // seed staleness: a.ts acknowledged at an old hash
    const sidecar = join(dir, ".pi", "dashboard", "kb", "dox-staleness.json");
    mkdirSync(join(dir, ".pi", "dashboard", "kb"), { recursive: true });
    writeFileSync(sidecar, JSON.stringify({ "src/a.ts": "olddhash000" }));
    const before = decideNudge(dir, join(dir, "src", "a.ts"));
    expect(before?.kind).toBe("stale");
    acknowledgeRows(dir, join(dir, "AGENTS.md"));
    const after = decideNudge(dir, join(dir, "src", "a.ts"));
    expect(after).toBeNull(); // acknowledged → current hash → not stale
  });

  it("dedup: a path nudged once is not nudged again (session state)", () => {
    const state = createReindexState();
    const key = `missing:src/b.ts`;
    expect(state.nudged.has(key)).toBe(false);
    state.nudged.add(key);
    expect(state.nudged.has(key)).toBe(true); // extension skips when present
  });
});
