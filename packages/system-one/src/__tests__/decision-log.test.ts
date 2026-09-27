/**
 * Decision log content, write-failure tolerance, retention. Tasks 4.1–4.3
 * (test-plan E11, X8, X9). See change: add-system-one-registry.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pruneDecisionLogs } from "../decision-log.js";
import { predict } from "../predict.js";
import { chainConfig, freshState } from "./helpers/config.js";
import { type FakeBackend, startFakeBackend } from "./helpers/fake-backend.js";

const dir = () => join(homedir(), ".pi", "agent", "system-one", "decisions");
let f: FakeBackend;
beforeEach(async () => {
  freshState();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  f = await startFakeBackend();
  chainConfig({ f: f.url });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await f.close();
});

describe("E11 log content (4.1)", () => {
  it("records distributions and a state hash, never state or instructions", async () => {
    for (let i = 0; i < 3; i++)
      await predict({
        consumer: { id: "c", failurePolicy: "fail-open" },
        state: `state with SECRET-MARKER ${i}`,
        questions: {
          n: { type: "noul", instructions: "INSTR-MARKER" },
          ch: { type: "choice", instructions: "INSTR-MARKER", criteria: { a: "INSTR-MARKER", b: "" } },
        },
      });
    const files = readdirSync(dir());
    expect(files).toEqual([expect.stringMatching(new RegExp(`^\\d{4}-\\d{2}-\\d{2}\\.${process.pid}\\.jsonl$`))]);
    const path = join(dir(), files[0]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const text = readFileSync(path, "utf8");
    expect(text).not.toContain("SECRET-MARKER");
    expect(text).not.toContain("INSTR-MARKER");
    const lines = text.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      consumerId: "c",
      attempts: [{ backendId: "f", outcome: "ok", latencyMs: expect.any(Number) }],
      model: "fake-1",
      mode: "shadow",
      answers: { n: { noul: 0.7 }, ch: { choice: "a", probabilities: { a: 1, b: 0 } } },
      stateSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });
});

describe("X8 write-failure tolerance (4.2)", () => {
  it("predict still succeeds when decisions/ and consumers/ are read-only", async () => {
    const root = join(homedir(), ".pi", "agent", "system-one");
    for (const d of ["decisions", "consumers"]) {
      mkdirSync(join(root, d), { recursive: true });
      chmodSync(join(root, d), 0o500);
    }
    try {
      const r = await predict({ consumer: { id: "ro", failurePolicy: "fail-open" }, state: "s", questions: { n: { type: "noul", instructions: "i" } } });
      expect(r.ok).toBe(true);
    } finally {
      for (const d of ["decisions", "consumers"]) chmodSync(join(root, d), 0o700);
    }
  });
});

describe("X9 retention (4.3)", () => {
  it("deletes files older than 30 days", () => {
    mkdirSync(dir(), { recursive: true });
    const day = 86_400_000;
    const now = Date.now();
    const mk = (daysAgo: number) => {
      const d = new Date(now - daysAgo * day).toISOString().slice(0, 10);
      const p = join(dir(), `${d}.1234.jsonl`);
      writeFileSync(p, "{}\n");
      const t = (now - daysAgo * day) / 1000;
      utimesSync(p, t, t);
      return p;
    };
    const p29 = mk(29);
    const p30 = mk(30);
    const p31 = mk(31);
    pruneDecisionLogs(now);
    expect(existsSync(p29)).toBe(true);
    expect(existsSync(p30)).toBe(true);
    expect(existsSync(p31)).toBe(false);
  });
});
