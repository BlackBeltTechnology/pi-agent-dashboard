import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteFtsStore } from "@blackbelt-technology/pi-dashboard-kb";
import { describe, expect, it } from "vitest";
import { main } from "../cli.js";
import { latestRunId } from "../commands/run.js";
import type { SnapshotDeps } from "../snapshot.js";
import { makeEnv, type TestEnv } from "./helpers/ctx.js";
import { createHermesDb } from "./helpers/hermes-db.js";
import { judgeEnv } from "./helpers/judge-env.js";
import { hermesDbPath, mkCase, writeCaseSet } from "./helpers/run-fixture.js";
import { bash, uuid, writeSession } from "./helpers/sessions.js";

const T = "2026-02-01T12:00:00.000Z";
const OTHER = "00000000-0000-4000-8000-0000000000bb";

function walEnv(deps?: Partial<SnapshotDeps>) {
  const env = makeEnv({ snapshotDeps: deps });
  writeCaseSet(env, [mkCase({ id: "c1", decisionTime: T })]);
  const h = createHermesDb(
    hermesDbPath(env),
    { sessions: [{ id: OTHER, project: "synth" }], messages: [{ session: OTHER, content: "kaboom failure", ts: "2026-02-01T11:00:00.000Z", id: "m1" }] },
    { wal: true },
  );
  return { env, h };
}
const run = (env: TestEnv) => main(["run", "--hermes-project", "synth", "--retrievers", "hermes.session_search.recent"], env.ctx);
const manifestOf = (env: TestEnv) => JSON.parse(readFileSync(join(env.paths.runsDir, latestRunId(env.paths.runsDir), "manifest.json"), "utf8"));

describe("snapshot", () => {
  it("X5: a writer racing the copy retries; a source that never settles aborts", async () => {
    const racing = (when: (attempt: number) => boolean): Partial<SnapshotDeps> => ({
      statFile(path, info) {
        const real = { size: 100, mtimeMs: 1, salt: "" };
        if (path.endsWith("-wal") && info.phase === "after" && when(info.attempt)) return { ...real, size: 999 };
        if (path.endsWith("-wal")) return real;
        return { size: 4096, mtimeMs: 1, salt: "" };
      },
    });
    const a = walEnv(racing((n) => n === 1));
    expect(await run(a.env)).toBe(0);
    expect(manifestOf(a.env).snapshots.hermes.attempts).toBe(2);
    a.h.close();

    const b = walEnv(racing(() => true));
    expect(await run(b.env)).not.toBe(0);
    expect(b.env.stderr.join("")).toContain(hermesDbPath(b.env));
    expect(b.env.stderr.join("")).toMatch(/5 attempts/);
    b.h.close();
  });

  it("X6: an integrity failure on the first copy retries", async () => {
    const { env, h } = walEnv({
      copyFile(src, dst, attempt) {
        copyFileSync(src, dst);
        // Page 1 may live only in the WAL, so corrupt the main file AND drop the WAL frames.
        if (attempt === 1) writeFileSync(dst, src.endsWith("-wal") ? Buffer.alloc(0) : Buffer.alloc(8192, 7));
      },
    });
    expect(await run(env)).toBe(0);
    expect(manifestOf(env).snapshots.hermes.attempts).toBe(2);
    h.close();
  });

  it("snapshot folds uncheckpointed WAL rows and leaves no raw/ or -shm behind", async () => {
    const { env, h } = walEnv();
    expect(await run(env)).toBe(0);
    const id = latestRunId(env.paths.runsDir);
    const snapDir = join(env.paths.snapshotsDir, id);
    expect(readdirSync(snapDir).sort()).toEqual(["hermes.db"]);
    const retrieved = JSON.parse(readFileSync(join(env.paths.runsDir, id, "retrieved.json"), "utf8"));
    expect(retrieved.results["hermes.session_search.recent"].c1.top5.map((x: any) => x.ref)).toEqual(["m1"]);
    h.close();
  });

  it("X8: an absent hermes database marks its adapters unavailable and records absent", async () => {
    const env = makeEnv();
    writeCaseSet(env, [mkCase({ id: "c1", decisionTime: T })]);
    expect(existsSync(hermesDbPath(env))).toBe(false);
    expect(await main(["run", "--retrievers", "hermes.session_search.recent,hermes.memory_search"], env.ctx)).toBe(0);
    const id = latestRunId(env.paths.runsDir);
    const retrieved = JSON.parse(readFileSync(join(env.paths.runsDir, id, "retrieved.json"), "utf8"));
    expect(retrieved.retrievers.map((r: any) => [r.id, r.status])).toEqual([
      ["hermes.memory_search", "unavailable"],
      ["hermes.session_search.recent", "unavailable"],
    ]);
    expect(retrieved.results).toEqual({});
    expect(manifestOf(env).snapshots.hermes).toBe("absent");
  });

  it("X7: a full build/run/judge cycle leaves every source byte-identical", async () => {
    const env = judgeEnv();
    const hashOf = (p: string) => (existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : "absent");
    // Hermes: WAL mode, rows that exist only in the WAL (writer handle still open).
    const hermes = createHermesDb(
      hermesDbPath(env),
      { sessions: [{ id: OTHER, project: "synth" }], messages: [{ session: OTHER, content: "kaboom failure on a fresh checkout", ts: "2025-12-31T00:00:00.000Z", id: "wal-only" }] },
      { wal: true },
    );
    // kb index: a real store, left with its sidecars.
    const kbPath = join(env.home, "kb", "index.db");
    mkdirSync(join(env.home, "kb"), { recursive: true });
    const kb = new SqliteFtsStore(kbPath);
    kb.init();
    // Session files that `cases build` mines.
    writeSession(env.paths.sessionsDir, { id: uuid(1), start: "2026-01-01T10:00:00.000Z", steps: [bash("npx kaboomtool", "Error: kaboom failure", true)] });

    const sources = [hermesDbPath(env), `${hermesDbPath(env)}-wal`, `${hermesDbPath(env)}-shm`, kbPath, `${kbPath}-wal`, `${kbPath}-shm`, ...readdirSync(env.paths.sessionsDir).map((f) => join(env.paths.sessionsDir, f))];
    const before = sources.map(hashOf);
    expect(existsSync(`${hermesDbPath(env)}-wal`)).toBe(true);

    expect(await main(["cases", "build", "--set", "built"], env.ctx)).toBe(0);
    expect(await env.run(["--set", "built", "--kb-index", kbPath, "--hermes-project", "synth"])).toBe(0);
    expect(await env.judge()).toBe(0);

    expect(sources.map(hashOf)).toEqual(before);
    const retrieved = JSON.parse(readFileSync(env.runPath("retrieved.json"), "utf8"));
    const hits = Object.values(retrieved.results["hermes.session_search.recent"] as Record<string, any>).flatMap((r) => r.top5.map((h: any) => h.ref));
    expect(hits).toContain("wal-only"); // the snapshot folded in the WAL-only row
    expect(JSON.parse(readFileSync(env.runPath("manifest.json"), "utf8")).snapshots.hermes.fingerprint.messages).toBe(1);
    hermes.close();
    kb.close();
  });

  it("B5: a WAL that disappears between stat and copy is a failed attempt, not an abort", async () => {
    const vanish = (when: (attempt: number) => boolean): Partial<SnapshotDeps> => ({
      copyFile(src, dst, attempt) {
        if (src.endsWith("-wal") && when(attempt)) throw Object.assign(new Error("ENOENT: no such file or directory, copyfile"), { code: "ENOENT" });
        copyFileSync(src, dst);
      },
    });
    const once = walEnv(vanish((n) => n === 1));
    expect(await run(once.env)).toBe(0);
    expect(manifestOf(once.env).snapshots.hermes.attempts).toBe(2);
    once.h.close();

    const always = walEnv(vanish(() => true));
    expect(await run(always.env)).not.toBe(0);
    expect(always.env.stderr.join("")).toContain(hermesDbPath(always.env));
    // No transient raw/ copy is left behind on the failure path.
    const leftovers = existsSync(always.env.paths.snapshotsDir) ? readdirSync(always.env.paths.snapshotsDir).flatMap((id) => readdirSync(join(always.env.paths.snapshotsDir, id))) : [];
    expect(leftovers).not.toContain("raw");
    always.h.close();
  });

  it("B6: two runs started in the same second get distinct run ids", async () => {
    const env = makeEnv({ now: () => new Date("2026-02-01T12:00:00.000Z") });
    writeCaseSet(env, [mkCase({ id: "c1", decisionTime: T })]);
    // An async external adapter makes the runs interleave between choosing an id and writing results.
    const mod = join(env.home, "slow.mjs");
    writeFileSync(mod, `export default [{ id: "stub.slow", version: "1", asOf: "strict", search: async () => { await new Promise((r) => setTimeout(r, 30)); return []; } }];`);
    const args = ["run", "--retrievers", "hermes.memory_search", "--retriever-module", mod];
    const codes = await Promise.all([main(args, env.ctx), main(args, env.ctx), main(args, env.ctx)]);
    expect(codes).toEqual([0, 0, 0]);
    const ids = readdirSync(env.paths.runsDir);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(existsSync(join(env.paths.runsDir, id, "manifest.json"))).toBe(true);
  });

  it("B3 (round 3) / B1 (round 4): only a genuinely missing source is `absent`; empty and unreadable ones fail the run", async () => {
    // An empty file is not "absent" and not a database worth evaluating: fail, name the source, complete no run.
    const completed = (env: TestEnv) => (existsSync(env.paths.runsDir) ? readdirSync(env.paths.runsDir).filter((id) => existsSync(join(env.paths.runsDir, id, "manifest.json"))) : []);
    for (const source of ["hermes", "kb"] as const) {
      const env = makeEnv();
      writeCaseSet(env, [mkCase({ id: "c1", decisionTime: T })]);
      const path = source === "hermes" ? hermesDbPath(env) : join(env.home, "kb", "index.db");
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "");
      const args = source === "hermes" ? ["run", "--retrievers", "hermes.memory_search"] : ["run", "--retrievers", "kb.docs", "--kb-index", path];
      expect(await main(args, env.ctx), source).not.toBe(0);
      expect(env.stderr.join(""), source).toContain(path);
      expect(completed(env), source).toEqual([]);
    }

    if (process.getuid?.() === 0) return; // permissions are not enforced for root
    const locked = makeEnv();
    writeCaseSet(locked, [mkCase({ id: "c1", decisionTime: T })]);
    createHermesDb(hermesDbPath(locked), { sessions: [], messages: [] }).close();
    const dir = dirname(hermesDbPath(locked));
    chmodSync(dir, 0o000);
    try {
      expect(await main(["run", "--retrievers", "hermes.memory_search"], locked.ctx)).not.toBe(0);
    } finally {
      chmodSync(dir, 0o700);
    }
    expect(locked.stderr.join("")).toMatch(/EACCES|permission/i);
  });

  it("B1 (round 5): a non-empty database without the required tables fails the run", async () => {
    const completed = (env: TestEnv) => (existsSync(env.paths.runsDir) ? readdirSync(env.paths.runsDir).filter((id) => existsSync(join(env.paths.runsDir, id, "manifest.json"))) : []);
    for (const source of ["hermes", "kb"] as const) {
      const env = makeEnv();
      writeCaseSet(env, [mkCase({ id: "c1", decisionTime: T })]);
      const path = source === "hermes" ? hermesDbPath(env) : join(env.home, "kb", "index.db");
      mkdirSync(dirname(path), { recursive: true });
      const db = new DatabaseSync(path);
      db.exec("CREATE TABLE unrelated (x INTEGER); INSERT INTO unrelated VALUES (1)");
      db.close();
      const args = source === "hermes" ? ["run", "--retrievers", "hermes.memory_search"] : ["run", "--retrievers", "kb.docs", "--kb-index", path];
      expect(await main(args, env.ctx), source).not.toBe(0);
      expect(env.stderr.join(""), source).toContain(path);
      expect(env.stderr.join(""), source).toMatch(/missing table/i);
      expect(completed(env), source).toEqual([]);
    }
  });
});
