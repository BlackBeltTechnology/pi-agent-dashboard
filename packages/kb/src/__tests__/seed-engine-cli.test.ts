// Engine record in the gate, and the CLI writers' seeding. See change: add-kb-worktree-seed
// (test-plan E7, E8, E16/E19 via CLI flags, E23 for `kb index` and `kb search`).
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { setRunningEngineForTest } from "../index-gate.js";
import { SqliteFtsStore } from "../sqlite-store.js";
import { addWorktree, dump, indexAt, mkMain, useSeedTree } from "./helpers/seed-fixture.js";

const t = useSeedTree();
const dbOf = (cwd: string) => join(cwd, ".pi/dashboard/kb/index.db");
const kbDir = fileURLToPath(new URL("..", import.meta.url));
const cliEnv = (extra: Record<string, string> = {}) => ({ ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, "--experimental-sqlite"].filter(Boolean).join(" "), ...extra });
const kb = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, ["--import", "tsx", join(kbDir, "cli.ts"), ...args], { cwd: kbDir, encoding: "utf8", env: cliEnv(env) });
const meta = (cwd: string, k: string): string | null => {
  const s = SqliteFtsStore.openExisting(dbOf(cwd));
  try {
    return s ? s.getMeta(k) : null;
  } finally {
    s?.close();
  }
};
const oneSource = { sources: [{ ref: "docs" }], include: ["**/*.md"] };

describe("engine record in the gate", () => {
  it("E7 an engine change forces every source once; the next pass with the same engine forces nothing", async () => {
    mkMain(t);
    setRunningEngineForTest("A");
    await indexAt(t.main);
    expect(meta(t.main, "engine:docs")).toBe("A");
    setRunningEngineForTest("B");
    const forced = await indexAt(t.main);
    expect(forced.stats.changed).toBe(60);
    expect(meta(t.main, "engine:docs")).toBe("B");
    expect(meta(t.main, "engine:packages")).toBe("B");
    expect((await indexAt(t.main)).stats.changed).toBe(0);
  });

  it("E8 an interrupted forced pass leaves no engine record; a worktree keeps none of its rows; the next pass forces it", async () => {
    mkMain(t, { docs: 1500, pkgs: 0, config: oneSource });
    setRunningEngineForTest("A");
    await indexAt(t.main);
    expect(meta(t.main, "engine:docs")).toBe("A");

    // A child running engine B forces `docs`; kill it as soon as its first batch committed (record cleared).
    const child = spawn(process.execPath, ["--import", "tsx", join(kbDir, "cli.ts"), "index", "--cwd", t.main], { cwd: kbDir, env: cliEnv({ KB_ENGINE_FINGERPRINT: "B" }), stdio: "ignore" });
    const exited = new Promise<number | null>((res) => child.on("exit", res));
    const deadline = Date.now() + 60_000;
    let killed = false;
    while (Date.now() < deadline) {
      if (meta(t.main, "engine:docs") === null) {
        child.kill("SIGKILL");
        killed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    await exited;
    expect(killed).toBe(true);
    expect(meta(t.main, "engine:docs")).toBeNull();

    setRunningEngineForTest("B");
    const wt = addWorktree(t);
    const seeded = await indexAt(wt);
    expect(seeded.lines).toEqual([`[kb] seed=${t.main} sources=0/1`]);
    expect(seeded.stats.changed).toBe(1500); // nothing was kept

    const next = await indexAt(t.main); // the next pass forces docs again
    expect(next.stats.changed).toBe(1500);
    expect(meta(t.main, "engine:docs")).toBe("B");
  }, 120_000);
});

describe("CLI writers seed", () => {
  const seedLine = (stderr: string) => stderr.split("\n").filter((l) => l.startsWith("[kb] seed"));

  it("E23 `kb index` seeds; --no-seed and an explicit --source skip with `disabled`; --db is custom-dbpath", async () => {
    mkMain(t);
    await indexAt(t.main);
    const e = { KB_ENGINE_FINGERPRINT: "E1" };
    const wt = addWorktree(t, "w0");
    const r = kb(["index", "--cwd", wt], e);
    expect(r.status, r.stderr).toBe(0);
    expect(seedLine(r.stderr)).toEqual([`[kb] seed=${t.main} sources=2/2`]);

    const w1 = addWorktree(t, "w1");
    expect(seedLine(kb(["index", "--cwd", w1, "--no-seed"], e).stderr)).toEqual(["[kb] seed-skipped=disabled"]);
    const w2 = addWorktree(t, "w2");
    expect(seedLine(kb(["index", "--cwd", w2, "--source", "docs"], e).stderr)).toEqual(["[kb] seed-skipped=disabled"]);
    const w3 = addWorktree(t, "w3");
    expect(seedLine(kb(["index", "--cwd", w3, "--db", join(t.tmp, "x.db")], e).stderr)).toEqual(["[kb] seed-skipped=custom-dbpath"]);
  }, 120_000);

  it("E23 `kb search` auto-index of a missing database seeds, and the result equals the main index's", async () => {
    mkMain(t);
    await indexAt(t.main);
    const wt = addWorktree(t);
    const r = kb(["search", "intro3", "--cwd", wt, "--json"], { KB_ENGINE_FINGERPRINT: "E1" });
    expect(r.status, r.stderr).toBe(0);
    expect(seedLine(r.stderr)).toEqual([`[kb] seed=${t.main} sources=2/2`]);
    expect(dump(dbOf(wt)).files).toEqual(dump(dbOf(t.main)).files.map((f) => f)); // identical tree ⇒ identical file set
  }, 120_000);
});
