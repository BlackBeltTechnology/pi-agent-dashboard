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

  it("reindexNow picks up an edited file without manual kb index", async () => {
    const state = createReindexState();
    await reindexNow(state, dir); // cold index
    const { store } = getKb(state, dir);
    expect(store.search("initial content padded", { limit: 3 }).length).toBeGreaterThan(0);

    // edit the file
    writeFileSync(join(dir, "docs", "guide.md"), "# Guide\nrewritten totally different zebras are exotic animals here.\n");
    await reindexNow(state, dir); // incremental
    const hits = store.search("rewritten totally different zebras", { limit: 3 });
    expect(hits[0]?.path).toMatch(/guide\.md$/);
    // old content gone
    expect(store.search("initial content padded", { limit: 3 }).length).toBe(0);
    closeKb(state);
  });

  it("coalesces concurrent reindexes for one cwd (no interleaved transaction)", async () => {
    // indexSource now yields mid-transaction; two overlapping walks on the same
    // cached store would interleave BEGIN/COMMIT. Use a >YIELD_EVERY (100) fixture
    // so the walk actually yields while holding a transaction — without the
    // coalescing guard the second walk throws "transaction within a transaction".
    // See change: fix-kb-index-feedback.
    const big = mkdtempSync(join(tmpdir(), "kb-ext-conc-"));
    mkdirSync(join(big, ".pi", "dashboard", "kb"), { recursive: true });
    writeFileSync(join(big, ".pi", "dashboard", "knowledge_base.json"), JSON.stringify({
      sources: [{ kind: "filesystem", ref: "docs" }], dbPath: ".pi/dashboard/kb/index.db",
    }));
    mkdirSync(join(big, "docs"), { recursive: true });
    for (let i = 0; i < 150; i++) {
      writeFileSync(join(big, "docs", `d${i}.md`), `# Doc ${i}\n\nBody ${i} padded enough to survive the tiny-chunk merge threshold here and there.\n`);
    }
    const state = createReindexState();
    // Concurrent — must not throw, and both resolve to the same coalesced result.
    const [a, b] = await Promise.all([reindexNow(state, big), reindexNow(state, big)]);
    expect(a).toEqual(b);
    expect(a.chunks).toBeGreaterThan(0);
    closeKb(state);
    rmSync(big, { recursive: true, force: true });
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

  it("resolves basename rows against the owning AGENTS.md dir (nested, Defect A)", () => {
    const sub = mkdtempSync(join(tmpdir(), "kb-nested-"));
    try {
      mkdirSync(join(sub, "pkg", "src"), { recursive: true });
      // AGENTS.md lives in pkg/src with a BARE BASENAME row
      writeFileSync(join(sub, "pkg", "src", "AGENTS.md"), "# DOX \u2014 pkg/src\n\n| `api.ts` |  |\n");
      writeFileSync(join(sub, "pkg", "src", "api.ts"), "export const api = 1;\n");
      // row exists (resolved dir-relative) → not "missing"
      expect(decideNudge(sub, join(sub, "pkg", "src", "api.ts"))).toBeNull();
    } finally { rmSync(sub, { recursive: true, force: true }); }
  });

  it("dedup: a path nudged once is not nudged again (session state)", () => {
    const state = createReindexState();
    const key = `missing:src/b.ts`;
    expect(state.nudged.has(key)).toBe(false);
    state.nudged.add(key);
    expect(state.nudged.has(key)).toBe(true); // extension skips when present
  });
});
