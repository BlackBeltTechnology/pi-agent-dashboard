import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../cli.js";
import { latestRunId, type RetrievedFile } from "../commands/run.js";
import { sha256 } from "../util.js";
import { makeEnv, type TestEnv } from "./helpers/ctx.js";
import { createHermesDb, type FxMessage } from "./helpers/hermes-db.js";
import { hermesDbPath, mkCase, writeCaseSet } from "./helpers/run-fixture.js";

const T = "2026-02-01T12:00:00.000Z";
const OWN = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "00000000-0000-4000-8000-0000000000bb";
const sec = (iso: string, d: number) => new Date(Date.parse(iso) + d * 1000).toISOString();

async function doRun(env: TestEnv, args: string[] = []) {
  const code = await main(["run", "--hermes-project", "synth", ...args], env.ctx);
  let retrieved: RetrievedFile | undefined;
  let manifest: Record<string, any> | undefined;
  try {
    const id = latestRunId(env.paths.runsDir);
    retrieved = JSON.parse(readFileSync(join(env.paths.runsDir, id, "retrieved.json"), "utf8"));
    manifest = JSON.parse(readFileSync(join(env.paths.runsDir, id, "manifest.json"), "utf8"));
  } catch {
    /* no run written */
  }
  return { code, retrieved, manifest, stderr: env.stderr.join("") };
}

const msg = (session: string, content: string, ts: string, id: string): FxMessage => ({ session, content, ts, id });
const mod = (env: TestEnv, name: string, src: string) => {
  const p = join(env.home, name);
  mkdirSync(env.home, { recursive: true });
  writeFileSync(p, src);
  return p;
};
const refs = (r: RetrievedFile, rid: string, cid: string) => r.results[rid][cid].top5.map((h) => h.ref);

describe("retrievers", () => {
  it("E18: no future leakage", async () => {
    const env = makeEnv();
    writeCaseSet(env, [mkCase({ id: "c1", sessionId: OWN, decisionTime: T })]);
    createHermesDb(hermesDbPath(env), {
      sessions: [{ id: OTHER, project: "synth" }],
      messages: [msg(OTHER, "kaboom failure now", T, "at-T"), msg(OTHER, "kaboom failure before", sec(T, -1), "before")],
      memories: [
        { project: "synth", content: "kaboom failure memory same day", created: "2026-02-01" },
        { project: "synth", content: "kaboom failure memory yesterday", created: "2026-01-31" },
      ],
    }).close();
    const { code, retrieved } = await doRun(env, ["--retrievers", "hermes.session_search.recent,hermes.session_search.bm25,hermes.memory_search"]);
    expect(code).toBe(0);
    expect(refs(retrieved!, "hermes.session_search.recent", "c1")).toEqual(["before"]);
    expect(refs(retrieved!, "hermes.session_search.bm25", "c1")).toEqual(["before"]);
    expect(refs(retrieved!, "hermes.memory_search", "c1")).toHaveLength(1);
    for (const id of Object.keys(retrieved!.results)) expect(retrieved!.results[id].c1.asOfViolations).toBe(0);
  });

  it("E19: future rows do not take slots", async () => {
    const env = makeEnv();
    writeCaseSet(env, [mkCase({ id: "c1", sessionId: OWN, decisionTime: T })]);
    const messages: FxMessage[] = [];
    for (let i = 0; i < 20; i++) messages.push(msg(OTHER, "kaboom failure", sec(T, 100 + i), `future-${i}`));
    for (let i = 0; i < 10; i++) messages.push(msg(OTHER, `kaboom failure with plenty of extra padding words around it number ${i}`, sec(T, -100 - i), `ok-${i}`));
    const memories = [
      ...Array.from({ length: 20 }, (_, i) => ({ project: "synth", content: "kaboom failure", created: `2026-03-${String(i + 1).padStart(2, "0")}` })),
      ...Array.from({ length: 10 }, (_, i) => ({ project: "synth", content: `kaboom failure with plenty of padding text number ${i}`, created: `2026-01-${String(i + 1).padStart(2, "0")}` })),
    ];
    createHermesDb(hermesDbPath(env), { sessions: [{ id: OTHER, project: "synth" }], messages, memories }).close();
    const { retrieved } = await doRun(env, ["--retrievers", "hermes.session_search.recent,hermes.session_search.bm25,hermes.memory_search"]);
    const r = retrieved!.results;
    expect(r["hermes.session_search.recent"].c1.top10).toHaveLength(10);
    expect(r["hermes.memory_search"].c1.top10).toHaveLength(10);
    expect(r["hermes.session_search.bm25"].c1.top10.length).toBeGreaterThan(0);
    for (const id of ["hermes.session_search.recent", "hermes.session_search.bm25"]) {
      expect(r[id].c1.top10.every((h) => h.ref.startsWith("ok-")), id).toBe(true);
    }
    for (const id of Object.keys(r)) expect(r[id].c1.asOfViolations).toBe(0);
  });

  it("E20: a hit without timestamp is dropped and counted", async () => {
    const env = makeEnv();
    writeCaseSet(env, [mkCase({ id: "c1", decisionTime: T })]);
    const m = mod(env, "x.mjs", `export default [{ id: "stub.strict", version: "1", asOf: "strict", search: async (q) => [
      { ref: "a", text: "x" }, { ref: "b", text: "x", timestamp: q.asOf }, { ref: "c", text: "x", timestamp: "2020-01-01T00:00:00Z" } ] }];`);
    const { code, retrieved } = await doRun(env, ["--retrievers", "hermes.memory_search", "--retriever-module", m]);
    expect(code).toBe(0);
    expect(refs(retrieved!, "stub.strict", "c1")).toEqual(["c"]);
    expect(retrieved!.results["stub.strict"].c1.asOfViolations).toBe(2);
  });

  it("E21: same-day memory is excluded (UTC date of asOf)", async () => {
    const env = makeEnv();
    writeCaseSet(env, [mkCase({ id: "c1", decisionTime: new Date("2026-05-28T00:30:00+02:00").toISOString() })]);
    createHermesDb(hermesDbPath(env), {
      sessions: [],
      messages: [],
      memories: [
        { project: "synth", content: "kaboom failure on the same utc day", created: "2026-05-27" },
        { project: "synth", content: "kaboom failure on the earlier day", created: "2026-05-26" },
      ],
    }).close();
    const { retrieved } = await doRun(env, ["--retrievers", "hermes.memory_search"]);
    const top = retrieved!.results["hermes.memory_search"].c1.top5;
    expect(top).toHaveLength(1);
    expect(top[0].text).toContain("earlier day");
  });

  it("E22: own-session hits are removed and measured", async () => {
    const env = makeEnv();
    writeCaseSet(env, [mkCase({ id: "c1", sessionId: OWN, decisionTime: T })]);
    const messages: FxMessage[] = [];
    for (let i = 0; i < 8; i++) messages.push(msg(OWN, `kaboom failure own ${i}`, sec(T, -10 - i), `own-${i}`));
    for (let i = 0; i < 12; i++) messages.push(msg(OTHER, `kaboom failure other ${i}`, sec(T, -1000 - i), `oth-${i}`));
    createHermesDb(hermesDbPath(env), { sessions: [{ id: OWN, project: "synth" }, { id: OTHER, project: "synth" }], messages }).close();
    const { retrieved } = await doRun(env, ["--retrievers", "hermes.session_search.recent"]);
    const c = retrieved!.results["hermes.session_search.recent"].c1;
    expect(c.top5).toHaveLength(5);
    expect(c.top5.every((h) => h.sessionId !== OWN)).toBe(true);
    expect(c.top10.every((h) => h.sessionId !== OWN)).toBe(true);
    expect(c.ownTop5!.own).toBeGreaterThan(0);
    expect(c.ownTop5!.total).toBe(5);
  });

  it("E25: external adapter module is loaded and recorded", async () => {
    const env = makeEnv();
    writeCaseSet(env, [mkCase({ id: "c1", decisionTime: T })]);
    createHermesDb(hermesDbPath(env), { sessions: [{ id: OTHER, project: "synth" }], messages: [msg(OTHER, "kaboom failure", sec(T, -5), "m1")] }).close();
    const src = `export default [{ id: "context-manager.sessions", version: "1", asOf: "strict", search: async () => [] }];`;
    const m = mod(env, "x.mjs", src);
    const { code, retrieved, manifest } = await doRun(env, ["--retrievers", "hermes.session_search.recent", "--retriever-module", m]);
    expect(code).toBe(0);
    expect(Object.keys(retrieved!.results).sort()).toEqual(["context-manager.sessions", "hermes.session_search.recent"]);
    const entry = manifest!.retrievers.find((r: any) => r.id === "context-manager.sessions");
    expect(entry).toMatchObject({ version: "1", asOf: "strict", module: { path: m, sha256: sha256(src) } });
  });

  it("X9: invalid external module aborts before any search", async () => {
    const cases = [
      ["throws on import", `throw new Error("kaboom-import");`, "kaboom-import"],
      ["non-array export", `export default {};`, "Retriever[]"],
      ["reused id", `import { writeFileSync } from "node:fs"; export default [{ id: "kb.docs", version: "1", asOf: "none", search: async () => { writeFileSync(process.env.TOUCH_FILE, "x"); return []; } }];`, "kb.docs"],
    ] as const;
    for (const [, src, reason] of cases) {
      const env = makeEnv();
      writeCaseSet(env, [mkCase({ id: "c1" })]);
      const touch = join(env.home, "touched");
      process.env.TOUCH_FILE = touch;
      const m = mod(env, "bad.mjs", src);
      const { code, stderr } = await doRun(env, ["--retriever-module", m]);
      expect(code).not.toBe(0);
      expect(stderr).toContain(m);
      expect(stderr).toContain(reason);
      expect(existsSync(touch)).toBe(false);
      expect(existsSync(env.paths.runsDir)).toBe(false);
    }
  });

  it("X10: an adapter that never resolves is recorded as an error", async () => {
    const env = makeEnv({ searchTimeoutMs: 80 });
    writeCaseSet(env, [mkCase({ id: "c1", decisionTime: T })]);
    const m = mod(env, "x.mjs", `export default [
      { id: "stub.hang", version: "1", asOf: "strict", search: () => new Promise(() => {}) },
      { id: "stub.ok", version: "1", asOf: "strict", search: async () => [{ ref: "r", text: "t", timestamp: "2020-01-01T00:00:00Z" }] }];`);
    const { code, retrieved } = await doRun(env, ["--retriever-module", m]);
    expect(code).toBe(0);
    expect(retrieved!.results["stub.hang"].c1.error).toMatch(/timed out/);
    expect(retrieved!.results["stub.hang"].c1.top5).toEqual([]);
    expect(refs(retrieved!, "stub.ok", "c1")).toEqual(["r"]);
  });

  it("X11: schema-invalid hits are dropped and counted", async () => {
    const env = makeEnv();
    writeCaseSet(env, [mkCase({ id: "c1", decisionTime: T })]);
    const m = mod(env, "x.mjs", `export default [{ id: "stub.bad", version: "1", asOf: "strict", search: async () => [
      { ref: 1, text: "t", timestamp: "2020-01-01T00:00:00Z" }, { ref: "ok", text: "t", timestamp: "2020-01-01T00:00:00Z" }] }];`);
    const { retrieved } = await doRun(env, ["--retriever-module", m]);
    const c = retrieved!.results["stub.bad"].c1;
    expect(c.invalidHits).toBe(1);
    expect(c.top5.map((h) => h.ref)).toEqual(["ok"]);
  });
});
