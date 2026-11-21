import { describe, expect, it } from "vitest";
import { parseArgs, parseDuration } from "../args.ts";

describe("#E4 flag validation", () => {
  const ok = (argv: string[]) => {
    const r = parseArgs(["--group", "g", ...argv]);
    if (!r.ok) throw new Error(r.error);
    return r.args;
  };
  const bad = (argv: string[]) => {
    const r = parseArgs(["--group", "g", ...argv]);
    expect(r.ok).toBe(false);
    return r.ok ? "" : r.error;
  };

  it.each(["0", "2.5", "x"])("--parallel %s is a usage error", (v) => {
    expect(bad(["--parallel", v])).toMatch(/--parallel/);
  });
  it("--parallel 1 is ok and max-live defaults to 2N", () => {
    const a = ok(["--parallel", "1"]);
    expect(a.parallel).toBe(1);
    expect(a.maxLive).toBe(2);
  });
  it("max-live absent -> 2N (4 for the default N=2)", () => {
    expect(ok([]).maxLive).toBe(4);
  });
  it("max-live == N is rejected (a question could never free a slot)", () => {
    expect(bad(["--parallel", "2", "--max-live", "2"])).toMatch(/--max-live/);
  });
  it("max-live N+1 is ok", () => {
    expect(ok(["--parallel", "2", "--max-live", "3"]).maxLive).toBe(3);
  });
  it("documents the defaults", () => {
    const a = ok([]);
    expect([a.parallel, a.model, a.nudges, a.settleMs, a.startTimeoutMs]).toEqual([2, "@coding", 1, 30_000, 300_000]);
  });
  it("needs --group unless --status; rejects unknown flags", () => {
    expect(parseArgs([]).ok).toBe(false);
    expect(parseArgs(["--status"]).ok).toBe(true);
    expect(parseArgs(["--group", "g", "--nope"]).ok).toBe(false);
    expect(parseArgs(["--group", "g", "--dry-run", "--status"]).ok).toBe(false);
  });
  it("parses durations", () => {
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("45")).toBe(45_000);
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("0")).toBeNull();
  });
});
