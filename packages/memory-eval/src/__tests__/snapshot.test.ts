import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { SqliteFtsStore } from "@blackbelt-technology/pi-dashboard-kb";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../cli.js";
import { latestRunId } from "../commands/run.js";
import type { SnapshotDeps } from "../snapshot.js";
import { makeEnv, type TestEnv } from "./helpers/ctx.js";
import { createHermesDb } from "./helpers/hermes-db.js";
import { hermesDbPath, mkCase, writeCaseSet } from "./helpers/run-fixture.js";
import { judgeEnv } from "./helpers/judge-env.js";
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
});
