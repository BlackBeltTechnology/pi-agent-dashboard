/**
 * Append-only command log (change: add-chat-gateway-team-controls).
 * Scenarios: E21 (retention at the bound), X23 (distinct reasons), X25 (no edit
 * path), restart persistence.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCommandLog } from "../audit.js";

function entry(partial: Record<string, unknown> = {}) {
  return {
    principal: "u1",
    channelId: "c1",
    verb: "send_prompt",
    outcome: "permitted" as const,
    ...partial,
  };
}

describe("command log", () => {
  it("E21: at the limit nothing is discarded; one past it drops the oldest", () => {
    const log = createCommandLog({ limit: 5, now: () => 100 });
    for (let i = 0; i < 4; i++) log.append(entry({ target: `s${i}` }));
    expect(log.size()).toBe(4);

    log.append(entry({ target: "s4" }));
    expect(log.size()).toBe(5);
    expect(log.entries()[0].target).toBe("s0");

    log.append(entry({ target: "s5" }));
    expect(log.size()).toBe(5);
    expect(log.entries()[0].target).toBe("s1"); // oldest gone
    expect(log.entries().at(-1)?.target).toBe("s5"); // newest present
  });

  it("E21b: default-scale bound holds (limit 10,000)", () => {
    const log = createCommandLog({ limit: 10_000 });
    for (let i = 0; i < 10_000; i++) log.append(entry({ target: `s${i}` }));
    expect(log.size()).toBe(10_000);
    log.append(entry({ target: "last" }));
    expect(log.size()).toBe(10_000);
    expect(log.recent(1)[0].target).toBe("last");
  });

  it("X23: each refusal records its own distinct reason", () => {
    const log = createCommandLog({ limit: 100 });
    log.append(entry({ outcome: "refused", reason: "insufficient_tier" }));
    log.append(entry({ outcome: "refused", reason: "disarmed" }));
    const reasons = log.entries().map((e) => e.reason);
    expect(reasons).toEqual(["insufficient_tier", "disarmed"]);
  });

  it("X25: the interface exposes no edit or delete operation", () => {
    const log = createCommandLog({ limit: 10 });
    const mutating = Object.keys(log).filter((k) => /edit|delete|remove|update|clear|truncate|rewrite/i.test(k));
    expect(mutating).toEqual([]);
  });

  it("recent() is newest-first", () => {
    const log = createCommandLog({ limit: 10, now: () => 1 });
    log.append(entry({ target: "first" }));
    log.append(entry({ target: "second" }));
    log.append(entry({ target: "third" }));
    expect(log.recent().map((e) => e.target)).toEqual(["third", "second", "first"]);
  });

  describe("persistence", () => {
    let tmp: string;
    let filePath: string;

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmd-log-"));
      filePath = path.join(tmp, "command-log.json");
    });
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    it("survives a restart and discards oldest past the bound", () => {
      const first = createCommandLog({ filePath, limit: 3, now: () => 7 });
      first.append(entry({ target: "a" }));
      first.append(entry({ target: "b" }));

      const second = createCommandLog({ filePath, limit: 3, now: () => 8 });
      second.load();
      expect(second.size()).toBe(2);
      second.append(entry({ target: "c" }));
      second.append(entry({ target: "d" }));
      expect(second.size()).toBe(3);
      expect(second.entries()[0].target).toBe("b");

      const third = createCommandLog({ filePath, limit: 3 });
      third.load();
      expect(third.entries().map((e) => e.target)).toEqual(["b", "c", "d"]);
    });
  });
});

/**
 * Task 11.6 (round-2 review): the log is the operator's evidence, so it must
 * neither INVENT records nor go silent.
 */
describe("command log durability", () => {
  let tmp: string;
  let filePath: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-durability-"));
    filePath = path.join(tmp, "command-log.json");
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("drops an entry with a missing or unknown outcome, rather than loading it", () => {
    // `isEntry` checked principal/channel/verb but never `outcome`, so a
    // hand-edited or truncated file could load an entry with NO outcome — and
    // both the panel and the reason summary treat anything that is not
    // "refused" as permitted. That manufactures evidence of authorization that
    // never happened. An entry with no usable outcome is not evidence: drop it.
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        entries: [
          entry({ target: "ok" }),
          { principal: "u1", channelId: "c1", verb: "abort_run" },
          entry({ target: "bad", outcome: "maybe" }),
        ],
      }),
      { mode: 0o600 },
    );
    const log = createCommandLog({ filePath, limit: 10 });
    log.load();
    expect(log.entries().map((e) => e.target)).toEqual(["ok"]);
  });

  it("does not throw into the message path when the write fails, and reports it", () => {
    // `append` runs for EVERY authorized action, inside `authorizeRequest`. A
    // throw here reached the adapter's catch, which only logs — so a full disk
    // or a read-only state dir turned into a bot that stopped answering every
    // message. It must not be silent either: a lost write means the audit trail
    // no longer matches what happened.
    const failures: string[] = [];
    const blocked = path.join(tmp, "not-a-dir");
    fs.writeFileSync(blocked, "x", { mode: 0o600 });
    const log = createCommandLog({
      filePath: path.join(blocked, "command-log.json"),
      limit: 10,
      onPersistFailure: (message) => failures.push(message),
    });

    expect(() => log.append(entry())).not.toThrow();
    expect(log.size()).toBe(1); // the in-memory trail is still complete
    expect(failures).toHaveLength(1);
  });
});
