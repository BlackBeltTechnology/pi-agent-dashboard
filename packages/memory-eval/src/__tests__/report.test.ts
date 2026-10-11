import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Case } from "../cases.js";
import { main } from "../cli.js";
import { aggregate, loadRun, renderReport } from "../report.js";
import { mcnemarExact, wilson } from "../stats.js";
import { makeEnv, type TestEnv } from "./helpers/ctx.js";
import { type RunSpec, writeRun } from "./helpers/report-fixture.js";
import { mkCase } from "./helpers/run-fixture.js";

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(3, "0")}`);
const positives = (n: number, type: Case["type"] = "recurring_fault"): Case[] => ids("c", n).map((id) => mkCase({ id, type, query: `q ${id}`, context: `x ${id}` }));
const negatives = (n: number): Case[] => ids("n", n).map((id) => mkCase({ id, type: "negative", query: `q ${id}`, context: `x ${id}` }));
const RECENT = "hermes.session_search.recent";

function report(env: TestEnv, spec: RunSpec): string {
  writeRun(env, spec);
  return renderReport(aggregate(loadRun(env.paths, spec.runId)));
}
const agg = (env: TestEnv, spec: RunSpec) => (writeRun(env, spec), aggregate(loadRun(env.paths, spec.runId)));
const helpfulFirst = (k: number, cs: Case[]) => (_r: string, c: Case) => (cs.findIndex((x) => x.id === c.id) < k ? ("helpful" as const) : ("not_helpful" as const));

describe("report", () => {
  it("E37: Wilson interval on a known fixture", () => {
    const cs = positives(56);
    const text = report(makeEnv(), { runId: "r1", cases: cs, retrievers: [{ id: "hermes.memory_search" }], helpful: helpfulFirst(19, cs) });
    expect(text).toContain("19/56");
    expect(text).toContain("22.9%–47.0%");
    const w = wilson(19, 56);
    expect([w.lo, w.hi].map((x) => (x * 100).toFixed(1))).toEqual(["22.9", "47.0"]);
  });

  it("E38: unjudged items are excluded from the denominator", () => {
    const cs = positives(56);
    const text = report(makeEnv(), {
      runId: "r1",
      cases: cs,
      retrievers: [{ id: "hermes.memory_search" }],
      helpful: (_r, c) => (cs.findIndex((x) => x.id === c.id) < 3 ? undefined : "helpful"),
    });
    expect(text).toContain("53/53");
    expect(text).toContain("unjudged: 3");
  });

  it("E39: the union is over the judged intersection", () => {
    const cs = positives(56);
    const a = agg(makeEnv(), {
      runId: "r1",
      cases: cs,
      retrievers: [{ id: RECENT }, { id: "hermes.session_search.bm25" }],
      helpful: (r, c) => {
        const i = cs.findIndex((x) => x.id === c.id);
        if (r === RECENT && i < 2) return undefined;
        if (r !== RECENT && i === 2) return undefined;
        return i % 3 === 0 ? "helpful" : "not_helpful";
      },
    });
    expect(a.union!.overall.n).toBe(53);
    const env = makeEnv();
    const text = report(env, { runId: "r1", cases: cs, retrievers: [{ id: RECENT }, { id: "hermes.session_search.bm25" }], helpful: () => "helpful" });
    expect(text).toContain("n = 56");
  });

  it("E40: negatives use their own denominators", () => {
    const neg = negatives(31);
    const a = agg(makeEnv(), {
      runId: "r1",
      cases: neg,
      retrievers: [{ id: RECENT }],
      validity: (c) => (c.id === "n031" ? undefined : "valid"),
      helpful: (_r, c) => (c.id === "n001" || c.id === "n002" ? undefined : "not_helpful"),
    });
    const r = a.retrievers[0].negatives;
    expect([r.valid, r.validityUnjudged]).toEqual([30, 1]);
    expect(r.returnedAnything.n).toBe(30);
    expect(r.abstention.n).toBe(30);
    expect(r.judgedHelpful.n).toBe(28);
    expect(r.helpfulnessUnjudged).toBe(2);
  });

  const twoRuns = (env: TestEnv, a: Partial<RunSpec>, b: Partial<RunSpec>) => {
    const cs = positives(56);
    writeRun(env, { runId: "rA", cases: cs, retrievers: [{ id: RECENT }], ...a });
    writeRun(env, { runId: "rB", cases: cs, retrievers: [{ id: RECENT }], ...b });
  };

  it("E41: comparison refuses runs on different case sets", async () => {
    const env = makeEnv();
    writeRun(env, { runId: "rA", setName: "one", cases: positives(5), retrievers: [{ id: RECENT }] });
    writeRun(env, { runId: "rB", setName: "two", cases: positives(6), retrievers: [{ id: RECENT }] });
    const hashes = ["rA", "rB"].map((r) => JSON.parse(readFileSync(join(env.paths.runsDir, r, "retrieved.json"), "utf8")).caseSetHash);
    expect(await main(["report", "--compare", "rA", "rB"], env.ctx)).not.toBe(0);
    const err = env.stderr.join("");
    expect(err).toContain(hashes[0]);
    expect(err).toContain(hashes[1]);
  });

  it("E42: comparison refuses a different judge unless allowed", async () => {
    const env = makeEnv();
    twoRuns(env, { judge: { model: "judge-m1" } }, { judge: { model: "judge-m2" } });
    expect(await main(["report", "--compare", "rA", "rB"], env.ctx)).not.toBe(0);
    expect(env.stderr.join("")).toContain("judge-m1");
    expect(env.stderr.join("")).toContain("judge-m2");
    expect(await main(["report", "--compare", "rA", "rB", "--allow-judge-mismatch"], env.ctx)).toBe(0);
    expect(env.stdout.join("")).toContain("JUDGE MISMATCH");
  });

  it("E43: paired wins, losses and the exact McNemar p-value", async () => {
    const env = makeEnv();
    const cs = positives(56);
    const idx = (c: Case) => cs.findIndex((x) => x.id === c.id);
    // Different outputs per run (a verdict is keyed by case + output, not by run).
    twoRuns(
      env,
      { results: (_r, c) => ({ top5: [{ ref: "a", text: `a-${c.id}` }] }), helpful: (_r, c) => (idx(c) < 10 || (idx(c) >= 20 && idx(c) < 30) ? "helpful" : "not_helpful") },
      { results: (_r, c) => ({ top5: [{ ref: "b", text: `b-${c.id}` }] }), helpful: (_r, c) => ((idx(c) >= 10 && idx(c) < 12) || (idx(c) >= 20 && idx(c) < 30) ? "helpful" : "not_helpful") },
    );
    expect(await main(["report", "--compare", "rA", "rB"], env.ctx)).toBe(0);
    expect(env.stdout.join("")).toMatch(/\| 56 \| 10 \| 2 \| 44 \| 0\.0386 \|/);
    expect(mcnemarExact(10, 2).toFixed(4)).toBe("0.0386");
  });

  it("E44: reports carry no case text", async () => {
    const env = makeEnv();
    const marker = (n: number) => `zqx${(n * 2654435761 >>> 0).toString(16).padStart(8, "0")}abcd`;
    const cs = ids("c", 6).map((id, i) => mkCase({ id, type: i < 4 ? "recurring_fault" : "negative", query: `query ${marker(i)}`, context: `context ${marker(i + 10)}`, goldSessions: [`g${i}`] }));
    const spec = (runId: string): RunSpec => ({ runId, cases: cs, retrievers: [{ id: RECENT }, { id: "kb.docs", asOf: "none" }], results: (_r, c) => ({ top5: [{ ref: `ref-${marker(5)}`, text: `snippet ${marker(20)} ${c.id}`, sessionId: `g1` }], top10: [{ ref: "x", sessionId: "g1" }] }), helpful: () => "helpful" });
    writeRun(env, spec("rA"));
    writeRun(env, spec("rB"));
    expect(await main(["report", "--run", "rA"], env.ctx)).toBe(0);
    expect(await main(["report", "--compare", "rA", "rB"], env.ctx)).toBe(0);
    const everything = [env.stdout.join(""), ...readdirSync(env.paths.reportsDir).map((f) => readFileSync(join(env.paths.reportsDir, f), "utf8"))].join("\n");
    expect(everything.length).toBeGreaterThan(200);
    expect(everything).not.toMatch(/zqx[0-9a-f]{12}/);
  });

  it("E46: the sanity band flags helpful@5 outside 34% ± 15 points", () => {
    for (const [k, flagged] of [[10, true], [11, false], [27, false], [28, true]] as const) {
      const cs = positives(56);
      const a = agg(makeEnv(), { runId: "r1", cases: cs, retrievers: [{ id: RECENT }], helpful: helpfulFirst(k, cs) });
      expect(a.sanity!.flagged, `${k}/56`).toBe(flagged);
      expect(renderReport(a).includes("FLAGGED")).toBe(flagged);
    }
  });

  it("E49: blackhole is 0% by construction; gold hit@5/@10 come from stored top-10", () => {
    const cs = positives(4).map((c, i) => ({ ...c, goldSessions: [`gold-${i}`] }));
    const sess = (rank: number, gold?: string) => Array.from({ length: 10 }, (_, i) => ({ ref: `r${i}`, sessionId: i + 1 === rank && gold ? gold : `other-${i}` }));
    const a = agg(makeEnv(), {
      runId: "r1",
      cases: cs.map((c) => mkCase(c)),
      retrievers: [{ id: RECENT }],
      results: (_r, c) => ({ top10: c.id === "c001" ? sess(3, "gold-0") : c.id === "c002" ? sess(8, "gold-1") : sess(0) }),
    });
    expect(a.retrievers[0].gold.recurring_fault).toEqual({ n: 4, hit5: 1, hit10: 2 });
    const text = renderReport(a);
    expect(text).toContain("0% by construction");
    expect(text).toContain("1/4 / 2/4");
    // A retriever without session ids has no gold-session figures.
    const memory = agg(makeEnv(), { runId: "r2", cases: cs.map((c) => mkCase(c)), retrievers: [{ id: "hermes.memory_search" }] });
    expect(memory.retrievers[0].gold).toEqual({});
  });

  it("E26: kb.docs is a separate non-as-of reference and stays out of the union", () => {
    const cs = positives(10);
    const idx = (c: Case) => cs.findIndex((x) => x.id === c.id);
    const a = agg(makeEnv(), {
      runId: "r1",
      cases: cs,
      retrievers: [{ id: RECENT }, { id: "kb.docs", asOf: "none" }],
      helpful: (r, c) => (r === RECENT ? (idx(c) < 4 ? "helpful" : "not_helpful") : idx(c) >= 4 ? "helpful" : "not_helpful"),
    });
    expect(a.union!.retrieverIds).toEqual([RECENT]);
    expect(a.union!.overall).toMatchObject({ k: 4, n: 10 });
    const text = renderReport(a);
    const sep = text.indexOf("Non-as-of references");
    expect(sep).toBeGreaterThan(0);
    expect(text.indexOf("kb.docs")).toBeGreaterThan(sep);
  });

  it("surfaces as-of violations, under-fill and unavailable adapters", () => {
    const cs = positives(3);
    const text = report(makeEnv(), {
      runId: "r1",
      cases: cs,
      retrievers: [{ id: RECENT }, { id: "hermes.memory_search", status: "unavailable" }],
      results: (_r, c) => ({ asOfViolations: c.id === "c001" ? 2 : 0, underFill: c.id === "c002" }),
    });
    expect(text).toContain("as-of violations: 2");
    expect(text).toContain("under-fill: 1");
    expect(text).toMatch(/hermes\.memory_search[^\n]*\n\nunavailable/);
  });

  it("not-judged runs say so and show everything unjudged", () => {
    const text = report(makeEnv(), { runId: "r1", cases: positives(3), retrievers: [{ id: RECENT }], judge: null });
    expect(text).toContain("NOT JUDGED");
  });

  it("B7: a search that errored is neither abstention nor not-helpful", () => {
    const neg = negatives(10);
    const erroring = (c: Case) => ["n001", "n002", "n003", "n004"].includes(c.id);
    const a = agg(makeEnv(), {
      runId: "r1",
      cases: neg,
      retrievers: [{ id: RECENT }],
      results: (_r, c) => (erroring(c) ? { top5: [], top10: [], error: "search timed out" } : {}),
      helpful: () => "not_helpful",
    });
    const n = a.retrievers[0].negatives;
    expect(n.valid).toBe(10);
    expect(n.searchErrors).toBe(4);
    expect(n.returnedAnything).toMatchObject({ k: 6, n: 6 });
    expect(n.abstention).toMatchObject({ k: 0, n: 6 });
    expect(n.judgedHelpful.n).toBe(6);
    const cs = positives(10);
    const p = agg(makeEnv(), {
      runId: "r2",
      cases: cs,
      retrievers: [{ id: RECENT }, { id: "hermes.session_search.bm25" }],
      results: (r, c) => (r === RECENT && c.id === "c001" ? { top5: [], top10: [], error: "boom" } : {}),
      helpful: () => "helpful",
    });
    expect(p.retrievers.find((r) => r.id === RECENT)!.positives.overall.helpful.n).toBe(9);
    expect(p.retrievers.find((r) => r.id === RECENT)!.positives.overall.searchErrors).toBe(1);
    expect(p.union!.overall.n).toBe(9); // a constituent's failed search takes the case out of the union
    expect(renderReport(p)).toContain("search errors: 1");
  });
});
