import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexSource } from "@blackbelt-technology/pi-dashboard-kb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {acknowledgeRows, awaitFreshness, closeKb,
  closeKbForCwd, 
  createReindexState, decideNudge, ensurePopulated,getKb, nudgeText, reindexNow, resolveFreshnessBudgetMs, scheduleReindex,
} from "../reindex.js";

// Passthrough mock so X4 can make `indexSource` throw SQLITE_BUSY exactly once
// without a real cross-process SQLite lock (which would burn busy_timeout).
vi.mock("@blackbelt-technology/pi-dashboard-kb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-kb")>();
  return { ...actual, indexSource: vi.fn(actual.indexSource) };
});

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
    const { store } = getKb(state, dir)!;
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

describe("cwd removal: kb store does not resurrect the directory (husk regression)", () => {
  // Reproduces the confirmed husk mechanism: a live kb store holds
  // `<cwd>/.pi/dashboard/kb/index.db` open; the worktree dir is deleted
  // (git worktree remove); the next reindex tick's `mkdirSync` in the store
  // constructor RE-CREATES the dir by path → orphan husk. See change:
  // sweep-worktree-residual-on-remove.

  it("reindexNow after cwd removal is a no-op and never recreates the dir", async () => {
    const dir = setupProject();
    const state = createReindexState();
    await reindexNow(state, dir); // cold index — opens + caches the store

    // Simulate `git worktree remove`: the entire worktree dir vanishes.
    rmSync(dir, { recursive: true, force: true });
    expect(existsSync(dir)).toBe(false);

    // Force a cache-MISS so the next tick would construct a fresh store — this
    // is the resurrection vector: `new SqliteFtsStore` does mkdirSync(recursive)
    // and recreates `<cwd>/.pi/dashboard/kb` by path.
    state.kb.get(dir)?.store.close();
    state.kb.delete(dir);

    // A subsequent reindex tick MUST NOT recreate the directory.
    const result = await reindexNow(state, dir);
    expect(result).toEqual({ changed: 0, chunks: 0 });
    expect(existsSync(dir)).toBe(false); // husk NOT resurrected
    expect(state.kb.has(dir)).toBe(false); // no fresh store cached
    closeKb(state);
  });

  it("getKb on a removed cwd (cache miss) refuses to recreate the dir", async () => {
    const dir = setupProject();
    const state = createReindexState();
    await reindexNow(state, dir);
    state.kb.get(dir)?.store.close();
    state.kb.delete(dir);
    rmSync(dir, { recursive: true, force: true });

    expect(() => getKb(state, dir)).toThrow(/removed|cwd/i);
    expect(existsSync(dir)).toBe(false);
    closeKb(state);
  });

  it("closeKbForCwd evicts only the target cwd, leaving others open", async () => {
    const a = setupProject();
    const b = setupProject();
    const state = createReindexState();
    await reindexNow(state, a);
    await reindexNow(state, b);
    getKb(state, a); // the cold pass builds through the first-index path; opening is lazy
    getKb(state, b);
    expect(state.kb.has(a)).toBe(true);
    expect(state.kb.has(b)).toBe(true);

    closeKbForCwd(state, a);
    expect(state.kb.has(a)).toBe(false);
    expect(state.kb.has(b)).toBe(true);

    closeKb(state);
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  });
});

describe("cold-start populate: ensurePopulated (kb_neighbors / kb_get)", () => {
  // A never-indexed cwd must self-populate on first neighbors/get, mirroring
  // kb_search's freshness reindex; a warm index must NOT be re-walked.
  // See change: fix-kb-neighbors-get-cold-start.

  it("populates an empty index on first call (cold start)", async () => {
    const dir = setupProject();
    const state = createReindexState();
    await ensurePopulated(state, dir); // cold KB — never indexed before
    const { store } = getKb(state, dir)!;
    expect(store.counts().chunks).toBeGreaterThan(0);
    // proves neighbors/get would now see real data instead of empty
    expect(store.search("initial content padded", { limit: 3 }).length).toBeGreaterThan(0);
    closeKb(state);
    rmSync(dir, { recursive: true, force: true });
  });

  it("does NOT re-walk a warm index (empty-guard skips reindex)", async () => {
    const dir = setupProject();
    const state = createReindexState();
    await ensurePopulated(state, dir); // build once
    // Edit the source WITHOUT triggering a reindex.
    writeFileSync(join(dir, "docs", "guide.md"), "# Guide\nwarmskip token quokkas roam distant islands quietly here.\n");
    await ensurePopulated(state, dir); // chunks>0 → must skip the walk
    const { store } = getKb(state, dir)!;
    // The new content is NOT searchable — proves no walk ran on the warm path.
    expect(store.search("warmskip token quokkas", { limit: 3 }).length).toBe(0);
    expect(store.search("initial content padded", { limit: 3 }).length).toBeGreaterThan(0);
    closeKb(state);
    rmSync(dir, { recursive: true, force: true });
  });

  it("is a safe no-op on a removed cwd (degrade, never throws)", async () => {
    const dir = setupProject();
    rmSync(dir, { recursive: true, force: true });
    const state = createReindexState();
    await expect(ensurePopulated(state, dir)).resolves.toBeUndefined();
    expect(existsSync(dir)).toBe(false); // did not recreate the husk
    closeKb(state);
  });
});

describe("DOX nudge Job 2: decideNudge + acknowledgeRows", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "kb-doxext-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "AGENTS.md"), "# DOX\n\n| File | Purpose |\n|---|---|\n| `src/a.ts` |  |\n");
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
      writeFileSync(join(sub, "pkg", "src", "AGENTS.md"), "# DOX \u2014 pkg/src\n\n| File | Purpose |\n|---|---|\n| `api.ts` |  |\n");
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

// ── AsciiDoc reindex eligibility (change: asciidoc-support) ─────────────
describe("Job 1 debounce for AsciiDoc edits (test-plan #E18, #X2)", () => {
  // Isolate from the developer's own ~/.pi/dashboard/knowledge_base.json, whose
  // `include`/`extensions` override would otherwise decide what gets indexed.
  let home: string;
  let prevHome: string | undefined;
  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "kb-ext-home-"));
    prevHome = process.env.HOME;
    process.env.HOME = home;
  });
  afterAll(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("E18: an .adoc edit schedules a debounced reindex that lands in the index", async () => {
    const dir = setupProject();
    try {
      writeFileSync(join(dir, "docs", "spec.adoc"), "= Spec\n\n== Bravo\nasciidoc body padded well past the tiny-chunk merge threshold so it survives.\n");
      const state = createReindexState();
      scheduleReindex(state, dir, join(dir, "docs", "spec.adoc"), 30);
      expect(state.timers.size).toBe(1); // pending, not yet run
      await new Promise((r) => setTimeout(r, 200));
      expect(state.timers.size).toBe(0);
      const { store } = getKb(state, dir)!;
      expect(store.search("asciidoc body padded", { limit: 3 })[0]?.path).toMatch(/spec\.adoc$/);
      closeKb(state);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("E18: rapid successive edits collapse to a single pending reindex per cwd", () => {
    const dir = setupProject();
    try {
      const state = createReindexState();
      scheduleReindex(state, dir, join(dir, "docs", "a.adoc"), 5_000);
      const first = state.timers.get(dir);
      scheduleReindex(state, dir, join(dir, "docs", "b.adoc"), 5_000);
      const second = state.timers.get(dir);
      expect(state.timers.size).toBe(1); // keyed per cwd, never two pending walks
      expect(second).not.toBe(first); // the earlier timer was cleared + rescheduled
      closeKb(state); // clears the pending timer
      expect(state.timers.size).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("X2: a rejecting reindex on an .adoc edit is logged, not thrown", async () => {
    const dir = setupProject();
    writeFileSync(join(dir, ".pi", "dashboard", "knowledge_base.json"), "{ not json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const state = createReindexState();
      scheduleReindex(state, dir, join(dir, "docs", "x.adoc"), 10);
      await new Promise((r) => setTimeout(r, 150)); // debounce fires → reindexNow rejects
      expect(warn.mock.calls.some((c) => String(c[0]).includes("reindex failed"))).toBe(true);
      closeKb(state);
    } finally {
      warn.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── D8 / X4: debounced reindex tolerates SQLITE_BUSY (log + drop) ───────
describe("X4: SQLITE_BUSY on the debounced reindex", () => {
  it("logs a [kb] deferral, does not throw, and the next run succeeds", async () => {
    const dir = setupProject();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const state = createReindexState();
      await reindexNow(state, dir); // warm the index (the cold pass builds through the first-index path)
      const mocked = vi.mocked(indexSource);
      mocked.mockRejectedValueOnce(new Error("SQLITE_BUSY: database is locked"));
      scheduleReindex(state, dir, join(dir, "docs", "guide.md"), 10);
      await new Promise((r) => setTimeout(r, 250));
      expect(
        warn.mock.calls.some((c) => String(c[0]).startsWith("[kb]") && String(c[0]).includes("index busy")),
      ).toBe(true);

      // Not rethrown + state not poisoned: the next scheduled reindex indexes.
      scheduleReindex(state, dir, join(dir, "docs", "guide.md"), 10);
      await new Promise((r) => setTimeout(r, 400));
      const { store } = getKb(state, dir)!;
      expect(store.search("initial content padded", { limit: 3 }).length).toBeGreaterThan(0);
      closeKb(state);
    } finally {
      warn.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- test-plan #E44 (add-kb-git-forge-scope): the forge-command hint matcher -----------------
import { existsSync as hintExists, readdirSync as hintReaddir, statSync as hintStat, utimesSync as hintUtimes } from "node:fs";
import kbExtensionForHint, { isForgeCommand } from "../extension.js";
import { useRepoFixture } from "./helpers/git-repo.js";

describe("E44: git-scope hint matcher (tool_result, before the bash early return)", () => {
  const fx = useRepoFixture();

  function loadHandlers() {
    const handlers: Array<(e: unknown, c: unknown) => unknown> = [];
    const pi = { registerTool: () => {}, on: (n: string, h: (e: unknown, c: unknown) => unknown) => n === "tool_result" && handlers.push(h) } as unknown as Parameters<typeof kbExtensionForHint>[0];
    kbExtensionForHint(pi, { gitScope: { log: () => {} } });
    return async (cwd: string, event: Record<string, unknown>) => {
      for (const h of handlers) await h({ toolName: "bash", ...event }, { cwd });
    };
  }
  const hintFile = (): string | null => {
    const base = join(fx.home, ".pi", "dashboard", "kb", "git");
    if (!hintExists(base)) return null;
    const [key] = hintReaddir(base);
    return key && hintExists(join(base, key, "hint")) ? join(base, key, "hint") : null;
  };

  it("touches the sidecar for forge commands only; the rest of the hook still runs", async () => {
    const dir = fx.repo({ remote: "https://github.com/a/r.git" });
    const fire = loadHandlers();
    const run = (command: string, extra: Record<string, unknown> = {}) => fire(dir, { input: { command }, content: [], ...extra });

    await run("git status");
    await run('echo "gh pr create"');
    await run("echo gh pr create");
    expect(hintFile()).toBeNull(); // nothing matched yet

    const stamp = () => hintStat(hintFile() as string).mtimeMs;
    for (const [i, command] of ["gh pr create -t x", "cd a && git push origin main", "glab mr merge 3"].entries()) {
      if (hintFile()) hintUtimes(hintFile() as string, 1_000, 1_000); // age it so an advance is observable
      await run(command);
      expect(hintFile(), `command #${i}: ${command}`).not.toBeNull();
      expect(stamp()).toBeGreaterThan(1_000_000);
    }
    // a failed command does not hint
    hintUtimes(hintFile() as string, 1_000, 1_000);
    await run("gh pr create -t y", { isError: true });
    expect(stamp()).toBe(1_000_000);
    // an indexable write still reaches the reindex logic (hint code sits before the early return only)
    await fire(dir, { toolName: "write", input: { path: join(dir, "docs", "x.md") } });
  });

  it("isForgeCommand: segment-level matching table", () => {
    expect(isForgeCommand("gh pr create -t x")).toBe(true);
    expect(isForgeCommand("cd a && git push")).toBe(true);
    expect(isForgeCommand("glab mr merge 3")).toBe(true);
    expect(isForgeCommand("GH_TOKEN=x gh issue close 4")).toBe(true);
    expect(isForgeCommand("git status")).toBe(false);
    expect(isForgeCommand("echo gh pr create")).toBe(false);
    expect(isForgeCommand("gh pr view 3")).toBe(false);
    expect(isForgeCommand("git fetch && git pull")).toBe(false);
  });
});

// --- change: bound-kb-search-freshness -------------------------------------
type IndexResult = Awaited<ReturnType<typeof indexSource>>;
const OK: IndexResult = { scanned: 0, changed: 0, deleted: 0, chunks: 0 };
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("freshness budget parse (E1–E8)", () => {
  it.each([
    [undefined, 1500], ["", 1500], ["   ", 1500], ["0", 0], ["1", 1],
    [" 2000 ", 2000], ["59999", 59999], ["60000", 60000], ["60001", 60000],
    ["99999999999999999999", 60000],
    ["-1", 1500], ["1500.5", 1500], ["1e3", 1500], ["1500ms", 1500], ["abc", 1500], ["+5", 1500], ["0x10", 1500],
  ])("%j → %i", (raw, expected) => {
    expect(resolveFreshnessBudgetMs(raw as string | undefined)).toBe(expected);
  });
  it("-1 is not 'never wait' (0 is)", () => {
    expect(resolveFreshnessBudgetMs("-1")).not.toBe(0);
  });
});

describe("awaitFreshness + completed set", () => {
  const dirs: string[] = [];
  // Warm index (built through the real first-index path) so the controlled passes below go
  // through `indexSource`, which these tests mock; the cold path is covered in
  // index-integrity-reindex.test.ts. See change: fix-kb-index-integrity.
  const proj = () => {
    const d = setupProject();
    dirs.push(d);
    return d;
  };
  const warmUp = async (d: string) => {
    const s = createReindexState();
    await reindexNow(s, d);
    closeKb(s);
  };
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(indexSource).mockReset();
    vi.mocked(indexSource).mockImplementation(async (...a) => (await vi.importActual<typeof import("@blackbelt-technology/pi-dashboard-kb")>("@blackbelt-technology/pi-dashboard-kb")).indexSource(...a));
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("E16: removed cwd → reindexNow no-op; completed lacks cwd", async () => {
    const dir = proj();
    const state = createReindexState();
    rmSync(dir, { recursive: true, force: true });
    await expect(reindexNow(state, dir)).resolves.toEqual({ changed: 0, chunks: 0 });
    expect(state.completed.has(dir)).toBe(false);
  });

  it("E17: warm index, nothing in flight, budget 0, if-empty → done, no walk, completed unchanged", async () => {
    const dir = proj();
    const state = createReindexState();
    await reindexNow(state, dir);
    state.completed.delete(dir);
    vi.mocked(indexSource).mockClear();
    await expect(awaitFreshness(state, dir, { start: "if-empty", budgetMs: 0 })).resolves.toBe("done");
    expect(indexSource).not.toHaveBeenCalled();
    expect(state.completed.has(dir)).toBe(false);
    closeKb(state);
  });

  it("E18/X4: a rejected pass → failed; completed lacks cwd; no unhandled rejection", async () => {
    const dir = proj();
    await warmUp(dir);
    const state = createReindexState();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      vi.mocked(indexSource).mockRejectedValueOnce(new Error("walk exploded"));
      await expect(awaitFreshness(state, dir, { start: "always", budgetMs: 1000 })).resolves.toBe("failed");
      expect(state.completed.has(dir)).toBe(false);
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
      warn.mockRestore();
      closeKb(state);
    }
  });

  it("X3: a pass rejecting AFTER every waiter timed out is handled and warned exactly once", async () => {
    const dir = proj();
    await warmUp(dir);
    const state = createReindexState();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const d = deferred<IndexResult>();
    try {
      vi.mocked(indexSource).mockImplementationOnce(() => d.promise);
      await expect(awaitFreshness(state, dir, { start: "always", budgetMs: 10 })).resolves.toBe("timeout");
      d.reject(new Error("late failure"));
      await new Promise((r) => setTimeout(r, 30));
      expect(unhandled).not.toHaveBeenCalled();
      expect(warn.mock.calls.filter((c) => String(c[0]).includes("late failure"))).toHaveLength(1);
    } finally {
      process.off("unhandledRejection", unhandled);
      warn.mockRestore();
      closeKb(state);
    }
  });

  it("F1/F2/F4: timeout abandons the wait not the work; later callers join; completion is recorded", async () => {
    const dir = proj();
    await warmUp(dir);
    const state = createReindexState();
    const d = deferred<IndexResult>();
    vi.mocked(indexSource).mockImplementationOnce(() => d.promise);
    expect(await awaitFreshness(state, dir, { start: "always", budgetMs: 10 })).toBe("timeout");
    const joined = state.inflight.get(dir);
    expect(joined).toBeDefined();
    expect(await awaitFreshness(state, dir, { start: "always", budgetMs: 10 })).toBe("timeout"); // call #2 joins D
    expect(indexSource).toHaveBeenCalledTimes(1);
    // debounce path coalesces onto the same promise
    expect(reindexNow(state, dir)).toBe(joined);
    d.resolve(OK);
    await joined;
    expect(state.completed.has(dir)).toBe(true);
    expect(await awaitFreshness(state, dir, { start: "always", budgetMs: 1000 })).toBe("done"); // call #3, fresh pass
    closeKb(state);
  });

  it("F3: mid-walk (chunks > 0, inflight set) kb_get-style call joins instead of skipping", async () => {
    const dir = proj();
    const state = createReindexState();
    await reindexNow(state, dir); // chunks > 0 now
    const d = deferred<IndexResult>();
    vi.mocked(indexSource).mockClear();
    vi.mocked(indexSource).mockImplementationOnce(() => d.promise);
    const second = reindexNow(state, dir); // a pass is in flight
    expect(await awaitFreshness(state, dir, { start: "if-empty", budgetMs: 10 })).toBe("timeout");
    expect(indexSource).toHaveBeenCalledTimes(1); // no 2nd walk
    d.resolve(OK);
    await second;
    closeKb(state);
  });

  it("F6: budget 0, warm, nothing in flight, if-empty → no walk", async () => {
    const dir = proj();
    const state = createReindexState();
    await reindexNow(state, dir);
    vi.mocked(indexSource).mockClear();
    expect(await awaitFreshness(state, dir, { start: "if-empty", budgetMs: 0 })).toBe("done");
    expect(indexSource).not.toHaveBeenCalled();
    closeKb(state);
  });

  it("P6/P7: fake clock — never-resolving pass resolves at the budget; 1499 → done, 1501 → timeout", async () => {
    const dir = proj();
    await warmUp(dir);
    const state = createReindexState();
    vi.useFakeTimers();
    const never = deferred<IndexResult>();
    vi.mocked(indexSource).mockImplementationOnce(() => never.promise);
    let out: string | undefined;
    const p = awaitFreshness(state, dir, { start: "always", budgetMs: 1500 }).then((o) => (out = o));
    await vi.advanceTimersByTimeAsync(1499);
    expect(out).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2);
    await p;
    expect(out).toBe("timeout");
    never.resolve(OK);
    await vi.advanceTimersByTimeAsync(0);
    closeKb(state);

    const dir2 = proj();
    vi.useRealTimers();
    await warmUp(dir2);
    vi.useFakeTimers();
    const state2 = createReindexState();
    const fast = deferred<IndexResult>();
    vi.mocked(indexSource).mockImplementationOnce(() => fast.promise);
    let out2: string | undefined;
    const p2 = awaitFreshness(state2, dir2, { start: "always", budgetMs: 1500 }).then((o) => (out2 = o));
    await vi.advanceTimersByTimeAsync(1499);
    fast.resolve(OK);
    await p2;
    expect(out2).toBe("done");

    const dir3 = proj();
    vi.useRealTimers();
    await warmUp(dir3);
    vi.useFakeTimers();
    const state3 = createReindexState();
    const slow = deferred<IndexResult>();
    vi.mocked(indexSource).mockImplementationOnce(() => slow.promise);
    let out3: string | undefined;
    const p3 = awaitFreshness(state3, dir3, { start: "always", budgetMs: 1500 }).then((o) => (out3 = o));
    await vi.advanceTimersByTimeAsync(1501);
    await p3;
    expect(out3).toBe("timeout");
    slow.resolve(OK);
    await vi.advanceTimersByTimeAsync(0);
    closeKb(state2);
    closeKb(state3);
  });

  it("F8: fast path leaves no timer behind", async () => {
    const dir = proj();
    const state = createReindexState();
    vi.useFakeTimers();
    vi.mocked(indexSource).mockImplementationOnce(async () => OK);
    const before = vi.getTimerCount();
    expect(await awaitFreshness(state, dir, { start: "always", budgetMs: 1500 })).toBe("done");
    expect(vi.getTimerCount()).toBe(before);
    closeKb(state);
  });

  it("F9/F10: an aborted caller ends promptly; the shared pass and other waiters are unaffected", async () => {
    const dir = proj();
    const state = createReindexState();
    const d = deferred<IndexResult>();
    vi.mocked(indexSource).mockImplementationOnce(() => d.promise);
    const a = new AbortController();
    const pa = awaitFreshness(state, dir, { start: "always", budgetMs: 5000, signal: a.signal });
    const pb = awaitFreshness(state, dir, { start: "always", budgetMs: 5000 });
    a.abort();
    expect(await pa).toBe("aborted");
    d.resolve(OK);
    expect(await pb).toBe("done");
    expect(state.completed.has(dir)).toBe(true);
    closeKb(state);
  });

  it("aborted before start → aborted, no pass", async () => {
    const dir = proj();
    const state = createReindexState();
    vi.mocked(indexSource).mockClear();
    expect(await awaitFreshness(state, dir, { start: "always", budgetMs: 1000, signal: AbortSignal.abort() })).toBe("aborted");
    expect(indexSource).not.toHaveBeenCalled();
  });

  it("X11: cwd removed mid-pass + closeKbForCwd → pass settles; completed lacks cwd", async () => {
    const dir = proj();
    const state = createReindexState();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = deferred<IndexResult>();
    vi.mocked(indexSource).mockImplementationOnce(() => d.promise);
    const p = reindexNow(state, dir);
    rmSync(dir, { recursive: true, force: true });
    closeKbForCwd(state, dir);
    d.resolve(OK);
    await p.then(() => undefined, () => undefined);
    expect(state.completed.has(dir)).toBe(false);
    warn.mockRestore();
  });

  it("E31: completed is forgotten on closeKbForCwd and closeKb", async () => {
    const a = proj();
    const b = proj();
    const state = createReindexState();
    await reindexNow(state, a);
    await reindexNow(state, b);
    expect(state.completed.has(a)).toBe(true);
    closeKbForCwd(state, a);
    expect(state.completed.has(a)).toBe(false);
    expect(state.completed.has(b)).toBe(true);
    closeKb(state);
    expect(state.completed.size).toBe(0);
  });

  it("E19: a source dir that is missing completes the pass normally (completed set)", async () => {
    const dir = proj();
    rmSync(join(dir, "docs"), { recursive: true, force: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = createReindexState();
    await reindexNow(state, dir);
    expect(state.completed.has(dir)).toBe(true);
    warn.mockRestore();
    closeKb(state);
  });
});
