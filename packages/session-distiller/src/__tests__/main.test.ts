import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, copyFileSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run, parseArgs } from "../main.js";
import { candidatesPath } from "../cluster.js";
import { readWatermark } from "../watermark.js";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "session-multi.jsonl",
);
const CWD = "/repo";

let root: string;
let sessions: string;

/** Copy the fixture into a sessions dir under a session filename for sessionId `sid`. */
function placeSession(ts: string, sid: string) {
  const name = `${ts}_${sid}.jsonl`;
  const dest = join(sessions, name);
  // rewrite the embedded sessionId so each copy clusters as a distinct session
  const text = readFileSync(FIXTURE, "utf-8").replace(/"id":"sess1"/, `"id":"${sid}"`);
  writeFileSync(dest, text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "distill-main-root-"));
  sessions = mkdtempSync(join(tmpdir(), "distill-main-sess-"));
});

describe("CLI flag validation", () => {
  it("rejects a non-positive-integer --n", () => {
    expect(() => parseArgs(["--n", "x"])).toThrow(/positive integer/i);
    expect(() => parseArgs(["--n", "0"])).toThrow(/positive integer/i);
  });
  it("rejects a missing flag value", () => {
    expect(() => parseArgs(["--cwd"])).toThrow(/missing value/i);
  });
  it("rejects an unknown argument", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(/unknown argument/i);
  });
  it("parses a valid invocation", () => {
    const o = parseArgs(["--cwd", "/repo", "--n", "3", "--apply", "--json"]);
    expect(o).toMatchObject({ cwd: "/repo", n: 3, apply: true, json: true });
  });
});

describe("orchestrator run (tasks 4.5, integration)", () => {
  it("dry-run by default mutates no state", () => {
    placeSession("2026-06-20T10-00-00-000Z", "s1");
    const r = run({ cwd: CWD, n: 1, root, sessionsDir: sessions });
    expect(r.plan.dryRun).toBe(true);
    expect(r.processedSessions).toBe(1);
    expect(r.malformedLines).toBe(1); // fixture has one malformed line
    // watermark untouched in dry-run
    expect(readWatermark(CWD, root).lastTimestamp).toBe("");
  });

  it("promotes single-session signals when N=1 and routes them", () => {
    placeSession("2026-06-20T10-00-00-000Z", "s1");
    const r = run({ cwd: CWD, n: 1, root, sessionsDir: sessions });
    const signals = r.plan.entries.map((e) => e.signal).sort();
    expect(signals).toContain("fault");
    expect(signals).toContain("ask_user_decision");
    expect(signals).toContain("user_correction");
    expect(signals).toContain("procedure");
  });

  it("holds below-threshold clusters and auto-promotes across runs (N=3)", () => {
    placeSession("2026-06-20T10-00-00-000Z", "s1");
    const r1 = run({ cwd: CWD, n: 3, root, sessionsDir: sessions, apply: true });
    expect(r1.promoted.length).toBe(0); // held at 1 session

    placeSession("2026-06-21T10-00-00-000Z", "s2");
    const r2 = run({ cwd: CWD, n: 3, root, sessionsDir: sessions, apply: true });
    expect(r2.promoted.length).toBe(0); // held at 2

    placeSession("2026-06-22T10-00-00-000Z", "s3");
    const r3 = run({ cwd: CWD, n: 3, root, sessionsDir: sessions, apply: true });
    expect(r3.promoted.length).toBeGreaterThan(0); // promoted at 3
  });

  it("advances the watermark on --apply and re-run is a no-op", () => {
    placeSession("2026-06-20T10-00-00-000Z", "s1");
    const r1 = run({ cwd: CWD, n: 1, root, sessionsDir: sessions, apply: true });
    expect(readWatermark(CWD, root).lastTimestamp).toBe("2026-06-20T10:00:00.000Z");
    const r2 = run({ cwd: CWD, n: 1, root, sessionsDir: sessions, apply: true });
    expect(r2.processedSessions).toBe(0); // nothing newer than watermark
    void r1;
  });
});
