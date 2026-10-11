import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../cli.js";
import { createHermesDb } from "./helpers/hermes-db.js";
import { itemsIn, judgeEnv } from "./helpers/judge-env.js";
import { hermesDbPath, mkCase, writeCaseSet } from "./helpers/run-fixture.js";

/** Every leaf must be present and non-empty. */
function emptyLeaves(v: unknown, path = "$"): string[] {
  if (v === null || v === undefined || v === "") return [path];
  if (Array.isArray(v)) return v.length ? v.flatMap((x, i) => emptyLeaves(x, `${path}[${i}]`)) : [path];
  if (typeof v === "object") {
    const entries = Object.entries(v as object);
    return entries.length ? entries.flatMap(([k, x]) => emptyLeaves(x, `${path}.${k}`)) : [path];
  }
  return [];
}

const REQUIRED = ["runId", "date", "caseSet.name", "caseSet.hash", "caseSet.seed", "caseSet.quotas", "caseSet.inputFingerprint", "retrievers", "judge.role", "judge.model", "judge.promptVersion", "judge.validitySetHash", "versions.pi", "versions.hermes", "snapshots.hermes", "snapshots.kb", "kbChunkCount"];
const get = (o: any, path: string) => path.split(".").reduce((x, k) => x?.[k], o);

describe("manifest", () => {
  it("E45: a full run records every field, with `absent` sentinels", async () => {
    const env = judgeEnv();
    createHermesDb(hermesDbPath(env), { sessions: [{ id: "s1", project: "project" }], messages: [{ session: "s1", content: "kaboom failure", ts: "2020-01-01T00:00:00.000Z", id: "m1" }] }).close();
    const pkg = join(env.home, ".pi", "agent", "npm", "node_modules", "pi-hermes-memory");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ version: "9.9.9" }));
    expect(await env.run()).toBe(0);
    expect(await env.judge(["--judge", "@review"])).toBe(0);
    const m = JSON.parse(readFileSync(env.runPath("manifest.json"), "utf8"));
    for (const f of REQUIRED) expect(get(m, f), f).not.toBeUndefined();
    expect(emptyLeaves(m)).toEqual([]);
    expect(m.versions).toEqual({ pi: "0.0.0-test", hermes: "9.9.9" });
    expect(m.judge).toMatchObject({ role: "@review", model: "openai/gpt-6.1-sol:medium", promptVersion: "v1" });
    expect(m.snapshots.hermes.fingerprint).toMatchObject({ messages: 1 });
    expect(m.snapshots.kb).toBe("absent");
    expect(m.kbChunkCount).toBe("absent");
  });

  it("E45: with hermes absent the manifest still has no empty fields", async () => {
    const env = judgeEnv();
    expect(await env.run()).toBe(0);
    const m = JSON.parse(readFileSync(env.runPath("manifest.json"), "utf8"));
    expect(emptyLeaves(m)).toEqual([]);
    expect(m.snapshots.hermes).toBe("absent");
    expect(m.versions.hermes).toBe("absent");
    expect(m.judge.model).toBe("absent");
  });

  it("E48: status lists every run with hash, judged/unjudged counts and call outcomes", async () => {
    const env = judgeEnv();
    await env.run();
    const run1 = env.runId();
    await env.judge();
    // A second case set with two changed cases => two new validity items that stay unjudged.
    writeCaseSet(env, [mkCase({ id: "c1", query: "query 1", context: "context 1" }), mkCase({ id: "c2", query: "changed 2", context: "context 2" }), mkCase({ id: "c3", query: "changed 3", context: "context 3" })], "second");
    await env.run(["--set", "second"]);
    const run2 = env.runId();
    expect(run2).not.toBe(run1);
    env.stub({ omit: ["v:c2", "v:c3"] });
    await env.judge();
    expect(itemsIn(env.calls().at(-1)!.stdin).length).toBeGreaterThan(0);
    env.stdout.length = 0;
    expect(await main(["status"], env.ctx)).toBe(0);
    const out = env.stdout.join("");
    const l1 = out.split("\n").find((l) => l.split(/\s+/)[0] === run1)!;
    const l2 = out.split("\n").find((l) => l.split(/\s+/)[0] === run2)!;
    expect(l1).toMatch(/unjudged 0/);
    expect(l1).toMatch(/ok=\d+/);
    expect(l2).toMatch(/unjudged 2/);
    expect(l2).toMatch(/partial=\d+/);
    expect(l1).not.toBe(l2);
    expect(l1).toMatch(/case-set [0-9a-f]{16}/);
  });
});
