import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Case, CaseSet } from "../cases.js";
import { casePath, casesBuild } from "../commands/cases.js";
import { parseSessionText } from "../events.js";
import { isErrorResult, signatureOf } from "../signature.js";
import { makeEnv } from "./helpers/ctx.js";
import { bash, type SessionSpec, type Step, sessionText, user, uuid, writeSession } from "./helpers/sessions.js";

const FAIL = (cmd = "npx vitest run a", msg = "Error: boom 12") => bash(cmd, msg, true);
const FIX = (cmd = "pnpm vitest run a") => bash(cmd, "ok");
const iso = (start: string, n: number) => new Date(Date.parse(start) + n * 1000).toISOString();

function setup(specs: SessionSpec[], over = {}) {
  const env = makeEnv(over);
  for (const s of specs) writeSession(env.paths.sessionsDir, s);
  const build = (args: Parameters<typeof casesBuild>[1] = {}) => casesBuild(env.ctx, args);
  const read = (set = "baseline"): CaseSet => JSON.parse(readFileSync(casePath(env.paths.casesDir, set), "utf8"));
  return { env, build, read };
}
const S = (n: number, day: number, steps: Step[], extra: Partial<SessionSpec> = {}): SessionSpec => ({
  id: uuid(n),
  start: `2026-01-${String(day).padStart(2, "0")}T10:00:00.000Z`,
  steps,
  ...extra,
});
const ofType = (cs: CaseSet, t: string): Case[] => cs.cases.filter((c) => c.type === t);

describe("cases", () => {
  it("E1: build is deterministic across set names", () => {
    const { env, build } = setup([
      S(1, 1, [FAIL(), FIX()]),
      S(2, 2, [FAIL(), user("stuck again with this")]),
      S(3, 3, [FAIL("npx tsc -b", "Error: other 7")]),
    ]);
    expect(build({ set: "a" })).toBe(0);
    expect(build({ set: "b" })).toBe(0);
    const a = readFileSync(casePath(env.paths.casesDir, "a"), "utf8");
    const b = readFileSync(casePath(env.paths.casesDir, "b"), "utf8");
    expect(a).toBe(b);
    expect(JSON.parse(a).caseSetHash).toBe(JSON.parse(b).caseSetHash);
    expect(a).not.toMatch(/"a"|"b"/);
    expect(a).not.toContain(env.home);
    expect(a).not.toMatch(/"generatedAt"|"createdAt"/);
    expect(JSON.parse(a).cases.length).toBeGreaterThan(0);
  });

  it("E2: frozen set is not overwritten without --force", () => {
    const { env, build } = setup([S(1, 1, [FAIL(), FIX()]), S(2, 2, [FAIL()])]);
    expect(build()).toBe(0);
    const p = casePath(env.paths.casesDir, "baseline");
    const before = readFileSync(p, "utf8");
    const mtime = statSync(p).mtimeMs;
    expect(build()).not.toBe(0);
    expect(readFileSync(p, "utf8")).toBe(before);
    expect(statSync(p).mtimeMs).toBe(mtime);
    writeFileSync(p, "stale");
    expect(build({ force: true })).toBe(0);
    expect(readFileSync(p, "utf8")).toBe(before);
  });

  it("E3: recurring fault with changed fix; decision time = failing result", () => {
    const { build, read } = setup([S(1, 1, [FAIL(), FIX()]), S(2, 2, [user("hi"), FAIL()])]);
    build();
    const rf = ofType(read(), "recurring_fault");
    expect(rf).toHaveLength(1);
    expect(rf[0].sessionId).toBe(uuid(2));
    expect(rf[0].goldSessions).toContain(uuid(1));
    // user event at +1 s, call at +2 s, failing result at +3 s
    expect(rf[0].decisionTime).toBe(iso("2026-01-02T10:00:00.000Z", 3));
  });

  it("E4: unchanged approach is not a recurring fault", () => {
    const { build, read } = setup([S(1, 1, [FAIL(), FIX("npx vitest run b")]), S(2, 2, [FAIL()])]);
    build();
    expect(ofType(read(), "recurring_fault")).toHaveLength(0);
  });

  function sigsOf(cs: CaseSet, types: string[]) {
    return new Set(cs.cases.filter((c) => types.includes(c.type)).map((c) => c.signature));
  }
  const fault = (word: string) => [FAIL("npx vitest run a", `Error: ${word} broke`), FIX()];
  const filler = (n: number, day: number) => S(n, day, [user("noop")]);

  it("E5: frequent signatures are excluded (max(3, 5%))", () => {
    const specs: SessionSpec[] = [];
    for (let i = 1; i <= 5; i++) specs.push(S(i, i, fault("alpha")));
    for (let i = 6; i <= 11; i++) specs.push(S(i, i + 5 > 28 ? 28 : i + 5, fault("bravo"), { start: `2026-02-${String(i).padStart(2, "0")}T10:00:00.000Z` }));
    for (let i = 12; i <= 100; i++) specs.push({ ...filler(i, 1), start: `2026-03-01T10:00:${String(i % 60).padStart(2, "0")}.000Z` });
    const { build, read } = setup(specs);
    build();
    const sigs = sigsOf(read(), ["recurring_fault", "negative"]);
    expect([...sigs].some((s) => s?.includes("alpha"))).toBe(true);
    expect([...sigs].some((s) => s?.includes("bravo"))).toBe(false);

    const specs2: SessionSpec[] = [];
    for (let i = 1; i <= 3; i++) specs2.push(S(i, i, fault("charlie")));
    for (let i = 4; i <= 7; i++) specs2.push({ ...S(i, 1, fault("delta")), start: `2026-02-${String(i).padStart(2, "0")}T10:00:00.000Z` });
    for (let i = 8; i <= 40; i++) specs2.push({ ...filler(i, 1), start: `2026-03-01T10:00:${String(i % 60).padStart(2, "0")}.000Z` });
    const r2 = setup(specs2);
    r2.build();
    const sigs2 = sigsOf(r2.read(), ["recurring_fault", "negative"]);
    expect([...sigs2].some((s) => s?.includes("charlie"))).toBe(true);
    expect([...sigs2].some((s) => s?.includes("delta"))).toBe(false);
  });

  it("E6: generic signatures produce no cases", () => {
    const mk = (n: number, day: number) =>
      S(n, day, [
        bash("cat x", "(no output)", true),
        FIX("ls"),
        bash("cat y", "ENOENT: no such file or directory, open 'z'", true),
        FIX("ls -la"),
        { tool: "edit", args: { path: "a.ts" }, out: "Could not find the exact text in a.ts. The old text must match exactly.", isError: true },
        { tool: "edit", args: { path: "a.ts", n: 2 }, out: "ok" },
      ]);
    const { build, read } = setup([mk(1, 1), mk(2, 2)]);
    build();
    expect(read().cases.filter((c) => c.type === "recurring_fault" || c.type === "negative")).toHaveLength(0);
  });

  it("E7: first-ever failure is a negative", () => {
    const { build, read } = setup([S(1, 1, [FAIL("npx tsc -b", "Error: unique thing")])]);
    build();
    const neg = ofType(read(), "negative");
    expect(neg).toHaveLength(1);
    expect(neg[0].goldSessions).toEqual([]);
  });

  it("E8: user-flagged turns must be under 400 chars", () => {
    const t = (n: number) => `stuck again ${"y".repeat(n - 12)}`;
    const { build, read } = setup([S(1, 1, [user(t(399)), user(t(400))])]);
    build();
    const uf = ofType(read(), "user_flagged");
    expect(uf).toHaveLength(1);
    expect(uf[0].context).toHaveLength(399);
  });

  it("E9: pasted logs and skill prompts are not user-flagged", () => {
    const { build, read } = setup([
      S(1, 1, [
        user("again\n```\ncode\n```"),
        user("again\nat foo (x.ts:1:2)\nat bar (y.ts:3:4)"),
        user("again\nat single (z.ts:9:9)"),
        user("<skill name=x> again please"),
        user("again\n12:00:01 started\n12:00:02 failed"),
      ]),
    ]);
    build();
    const uf = ofType(read(), "user_flagged");
    expect(uf).toHaveLength(1);
    expect(uf[0].context).toContain("at single");
  });

  it("E10: Hungarian recurrence phrasing", () => {
    const { build, read } = setup([S(1, 1, [user("megint ugyanaz a hiba")])]);
    build();
    expect(ofType(read(), "user_flagged")).toHaveLength(1);
  });

  it("E11: explicit reference needs another session", () => {
    const { build, read } = setup([
      S(1, 1, [user(`I have another session ${uuid(2)} which contains the fix`), user(`see another session ${uuid(1)} which contains notes`)]),
    ]);
    build();
    const cs = read();
    const er = ofType(cs, "explicit_ref");
    expect(er).toHaveLength(1);
    expect(er[0].goldSessions).toEqual([uuid(2)]);
    expect(cs.cases.filter((c) => c.type === "user_flagged" || c.type === "explicit_ref")).toHaveLength(1);
  });

  it("E12: query skips cd/env prefixes and path tokens; user query clipped to 200", () => {
    const { build, read } = setup([
      S(1, 1, [bash("cd packages/kb && FOO=1 npx vitest run x", "Error: Cannot find module ./some/path/file.ts here", true), user(`again ${"z".repeat(244)}`)]),
    ]);
    build();
    const cs = read();
    const neg = ofType(cs, "negative")[0];
    expect(neg.query.startsWith("npx vitest")).toBe(true);
    expect(neg.query.split(/\s+/).some((w) => w.includes("/"))).toBe(false);
    expect(ofType(cs, "user_flagged")[0].query).toHaveLength(200);
  });

  it("E13: fix window is 15 events inclusive", () => {
    const fillers = (n: number): Step[] => Array.from({ length: n }, () => user("ok"));
    const mk = (gap: number) => setup([S(1, 1, [FAIL(), ...fillers(gap), FIX()]), S(2, 2, [FAIL()])]);
    // failing result, then `gap` user events, then the fix call at +gap+1
    const v1 = mk(14);
    v1.build();
    expect(ofType(v1.read(), "recurring_fault")).toHaveLength(1);
    const v2 = mk(15);
    v2.build();
    expect(ofType(v2.read(), "recurring_fault")).toHaveLength(0);
  });

  it("E14: signatures mask paths, numbers, hex ids and quoted strings", () => {
    const a = signatureOf("bash", "Error: cannot open /home/a/x.ts line 12 id deadbeef12 'foo'");
    const b = signatureOf("bash", "Error: cannot open /var/b/y.ts line 98 id cafebabe99 'bar'");
    expect(a).toBe(b);
    expect(signatureOf("bash", `Error: ${"a".repeat(113)}`).length).toBeLessThanOrEqual("bash|".length + 70);
  });

  it("E15: error detection", () => {
    const spec: SessionSpec = S(1, 1, [
      { tool: "bash", args: { command: "a" }, out: "plain", isError: true },
      { tool: "bash", args: { command: "b" }, out: "done\nCommand exited with code 2", noIsErrorField: true },
      { tool: "bash", args: { command: "c" }, out: "Command exited with code 0", noIsErrorField: true },
      { tool: "bash", args: { command: "d" }, out: `exited with code 1${"x".repeat(310)}`, noIsErrorField: true },
    ]);
    const res = parseSessionText("f.jsonl", sessionText(spec)).events.filter((e) => e.kind === "res");
    expect(res.map((r) => (r.kind === "res" ? isErrorResult(r) : null))).toEqual([true, true, false, false]);
  });

  it("E16: content hash covers the query; case id does not", () => {
    const msg = (tail: string) => `Error: ${["gggggggggg", "hhhhhhhhhh", "iiiiiiiiii", "jjjjjjjjjj", "kkkkkkkkkk", "llllllllll", "mmmmmmmmmm"].join(" ")} ${tail}`;
    const mk = (tail: string) => setup([S(1, 1, [FAIL("npx vitest run a", msg(tail)), FIX()]), S(2, 2, [FAIL("npx vitest run a", msg(tail))])]);
    const one = mk("TOKENONE");
    one.build();
    const two = mk("TOKENTWO");
    two.build();
    const a = one.read();
    const b = two.read();
    expect(ofType(a, "recurring_fault")[0].id).toBe(ofType(b, "recurring_fault")[0].id);
    expect(ofType(a, "recurring_fault")[0].contentHash).not.toBe(ofType(b, "recurring_fault")[0].contentHash);
    expect(a.caseSetHash).not.toBe(b.caseSetHash);
  });

  it("E17: embedded timestamps beat file names for ordering", () => {
    const early: SessionSpec = { ...S(1, 1, [FAIL(), FIX()]), fileName: "z-late-name.jsonl" };
    const late: SessionSpec = { ...S(2, 5, [FAIL()]), fileName: "a-early-name.jsonl" };
    const { build, read } = setup([early, late]);
    build();
    const rf = ofType(read(), "recurring_fault");
    expect(rf).toHaveLength(1);
    expect(rf[0].sessionId).toBe(uuid(2));
    expect(rf[0].goldSessions).toEqual([uuid(1)]);
  });

  it("X12: no sessions", () => {
    const missing = makeEnv();
    expect(casesBuild(missing.ctx)).not.toBe(0);
    expect(missing.stderr.join("")).toContain(missing.paths.sessionsDir);
    expect(existsSync(casePath(missing.paths.casesDir, "baseline"))).toBe(false);

    const empty = makeEnv();
    mkdirSync(empty.paths.sessionsDir, { recursive: true });
    writeFileSync(join(empty.paths.sessionsDir, "notes.txt"), "x");
    expect(casesBuild(empty.ctx)).not.toBe(0);
    expect(empty.stderr.join("")).toContain(empty.paths.sessionsDir);
    expect(existsSync(casePath(empty.paths.casesDir, "baseline"))).toBe(false);
  });

  it("B4: an earlier session only counts as gold when its fix landed before the decision time", () => {
    const fillers = (n: number): Step[] => Array.from({ length: n }, () => user("ok"));
    // S1 fails at +2 s and fixes at ~+9 s; S2 (started 1 s later) fails at +3 s, BEFORE that fix exists.
    const overlap = setup([
      S(1, 1, [FAIL(), ...fillers(5), FIX()], { start: "2026-01-01T10:00:00.000Z" }),
      S(2, 1, [FAIL()], { start: "2026-01-01T10:00:01.000Z" }),
    ]);
    overlap.build();
    expect(ofType(overlap.read(), "recurring_fault")).toHaveLength(0);
    // Control: the same S2 starting after S1's fix does get S1 as gold.
    const after = setup([
      S(1, 1, [FAIL(), ...fillers(5), FIX()], { start: "2026-01-01T10:00:00.000Z" }),
      S(2, 1, [FAIL()], { start: "2026-01-01T11:00:00.000Z" }),
    ]);
    after.build();
    const rf = ofType(after.read(), "recurring_fault");
    expect(rf).toHaveLength(1);
    expect(rf[0].goldSessions).toEqual([uuid(1)]);
  });
});
